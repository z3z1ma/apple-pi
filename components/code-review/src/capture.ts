import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { GitOptions } from "../../shared/src/git.js";
import {
	blobId,
	fileBlobId,
	GIT_DIFF,
	type GitChange,
	gitLine,
	gitRun,
	objectReader,
	openGitChange,
	rawFlags,
	settledAll,
} from "../../shared/src/git-change.js";
import { canonical, within } from "../../shared/src/real-path.js";
import { reviewConfiguration } from "./policy.js";
import type { ChangeRegion, ReviewArtifact, ReviewLabel, ReviewRequest, SourceEntry } from "./types.js";

const DIFF = [...GIT_DIFF, "--no-renames"];
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

async function reviewLabel(
	change: GitChange,
	repository: string,
	target: ReviewRequest["target"],
	signal?: AbortSignal,
): Promise<ReviewLabel> {
	const committed = target.kind !== "working-tree" && target.kind !== "staged";
	const [branch, subject, commits] = await settledAll([
		text(repository, ["symbolic-ref", "--short", "-q", "HEAD"], { signal }).catch(() => ""),
		committed ? change.git(["log", "-1", "--format=%s", change.headCommit], { signal }) : Promise.resolve(null),
		committed && change.baseCommit
			? change.git(["rev-list", "--count", `${change.baseCommit}..${change.headCommit}`], { signal })
			: Promise.resolve(null),
	] as const);
	return {
		branch: branch || null,
		subject: subject?.toString("utf8").trim() || null,
		commits: commits ? Number(commits.toString("utf8").trim()) : null,
	};
}

function artifactDigest(artifact: ReviewArtifact): string {
	return hash(
		JSON.stringify({
			version: artifact.version,
			repository: artifact.repository,
			commonDirectory: artifact.commonDirectory,
			kind: artifact.request.target.kind,
			baseCommit: artifact.baseCommit,
			headCommit: artifact.headCommit,
			paths: [...new Set(artifact.request.paths ?? [])].sort(),
			intent: artifact.intent,
			configuration: artifact.configuration,
			index: artifact.index,
			lenses: [...new Set(artifact.request.lenses ?? [])].sort(),
			baseTree: artifact.baseTree,
			headTree: artifact.headTree,
			files: artifact.files,
			regions: artifact.regions,
			changes: artifact.changes,
			omissions: artifact.omissions,
			patchHash: artifact.patchHash,
		}),
	);
}

const bytes = (cwd: string, args: string[], options?: GitOptions) => gitRun(cwd, args, options);
const text = (cwd: string, args: string[], options?: GitOptions) => gitLine(cwd, args, options);

function scopedPatch(artifact: ReviewArtifact, signal?: AbortSignal) {
	return bytes(
		artifact.source,
		[
			"--literal-pathspecs",
			...DIFF,
			"--binary",
			artifact.baseTree,
			artifact.headTree,
			"--",
			...(artifact.request.paths ?? []),
		],
		{ signal },
	);
}

/** Manifest, refs and comparison identity: enough to browse retained objects without the materialized copy. */
export async function verifyCapturedSource(artifact: ReviewArtifact, signal?: AbortSignal): Promise<void> {
	if (artifactDigest(artifact) !== artifact.digest) throw new Error("Review manifest identity changed");
	if (hash(await readFile(join(dirname(artifact.source), "change.patch"))) !== artifact.patchHash)
		throw new Error("Captured patch changed");
	const [head, base] = (await text(artifact.source, ["rev-parse", "HEAD", "base"], { signal })).split("\n");
	if (head !== artifact.headRevision || base !== artifact.baseRevision)
		throw new Error("Captured Git revisions changed");
	if (hash(await scopedPatch(artifact, signal)) !== artifact.patchHash) throw new Error("Captured comparison changed");
}

/** Measured on this checkout's first verification after capture: 1 reader 8.6 s, 8 readers 3.8 s, 32 and 128 no faster. */
const VERIFY_READERS = 8;

/**
 * Full integrity before recovery and decisions: every retained object, and every materialized path's mode and bytes
 * hashed against the retained head tree. This reads the files themselves rather than the checkout's index or
 * config, which reviewers' ordinary Git use can change (index flags, stat data, core.worktree).
 */
export async function verifyArtifact(artifact: ReviewArtifact, signal?: AbortSignal): Promise<void> {
	await verifyCapturedSource(artifact, signal);
	await text(artifact.source, ["fsck", "--no-reflogs", "--no-dangling"], { signal });
	const format = await text(artifact.source, ["rev-parse", "--show-object-format"], { signal });
	const directories = new Set<string>();
	const directory = async (path: string) => {
		if (directories.has(path)) return true;
		const found = (await lstat(path).catch(absent))?.isDirectory() ?? false;
		if (found) directories.add(path);
		return found;
	};
	const entries = await treeReferences(artifact.source, artifact.headTree, signal);
	let next = 0;
	let failure: { error: unknown } | undefined;
	const check = async () => {
		while (!failure && next < entries.length) {
			try {
				await checkEntry(entries[next++]!);
			} catch (error) {
				failure ??= { error };
			}
		}
	};
	const checkEntry = async (entry: (typeof entries)[number]) => {
		signal?.throwIfAborted();
		const parts = safePath(entry.path).split("/");
		for (let i = 1; i < parts.length; i++)
			if (!(await directory(join(artifact.source, ...parts.slice(0, i)))))
				throw new Error(`Captured source changed: ${entry.path}`);
		const path = join(artifact.source, ...parts);
		const stat = await lstat(path).catch(absent);
		const mode = stat?.isSymbolicLink()
			? "120000"
			: stat?.isDirectory()
				? "160000"
				: stat?.isFile()
					? stat.mode & 0o111
						? "100755"
						: "100644"
					: undefined;
		if (mode !== entry.mode) throw new Error(`Captured source changed: ${entry.path}`);
		if (mode === "160000") return;
		const id =
			mode === "120000"
				? blobId(format, await readlink(path, { encoding: "buffer" }))
				: await fileBlobId(format, path, signal);
		if (id !== entry.blob) throw new Error(`Captured source changed: ${entry.path}`);
	};
	// Every reader stops at the first failure and has finished before verification settles.
	await Promise.all(Array.from({ length: VERIFY_READERS }, check));
	if (failure) throw failure.error;
}

export async function readCapturedSource(
	artifact: ReviewArtifact,
	options: { path?: string; side?: "before" | "after" } = {},
	signal?: AbortSignal,
) {
	const path = options.path === undefined ? undefined : safePath(options.path);
	await verifyCapturedSource(artifact, signal);
	const side = options.side ?? "after";
	const tree = side === "before" ? artifact.baseTree : artifact.headTree;
	const identity = { artifact: artifact.digest, side, tree };
	if (path === undefined)
		return { ...identity, kind: "files" as const, files: await treeReferences(artifact.source, tree, signal) };
	const entry = (await treeReferences(artifact.source, tree, signal, path)).find((entry) => entry.path === path);
	if (!entry) throw new Error(`No captured file on the ${side} side: ${JSON.stringify(path)}`);
	const data =
		entry.mode === "160000" ? null : await bytes(artifact.source, ["cat-file", "blob", entry.blob], { signal });
	return {
		...identity,
		kind: "file" as const,
		file: { ...entry, content: classify(entry.mode, data ?? Buffer.from(entry.blob)) },
		bytes: data?.length ?? null,
		text: data && !data.includes(0) && isUtf8(data) ? data.toString("utf8") : null,
	};
}

function paths(value: Buffer): string[] {
	if (!isUtf8(value)) throw new Error("Review capture requires UTF-8 Git paths");
	return value.toString("utf8").split("\0").filter(Boolean);
}
function safePath(path: string) {
	if (
		!path ||
		path.startsWith("/") ||
		path.split("/").some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")
	)
		throw new Error(`Cannot materialize Git path: ${JSON.stringify(path)}`);
	return path;
}
const LFS = "version https://git-lfs.github.com/spec/v1\n";
function classify(mode: string, data: Buffer): SourceEntry["content"] {
	if (mode === "120000") return "symlink";
	if (mode === "160000") return "submodule";
	if (data.subarray(0, LFS.length).toString() === LFS) return "lfs";
	return data.includes(0) || !isUtf8(data) ? "binary" : "text";
}
async function absent(error: unknown): Promise<undefined> {
	if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ENOTDIR")
		throw error;
	return undefined;
}

async function treeReferences(root: string, tree: string, signal?: AbortSignal, path?: string) {
	return (await treeListing(root, tree, signal, path)).map(({ size: _, ...entry }) => entry);
}
/** `ls-tree -l` reports blob sizes, so pointer detection reads only small blobs. */
async function treeListing(root: string, tree: string, signal?: AbortSignal, path?: string) {
	const args = ["--literal-pathspecs", "ls-tree", "-rlz", "--full-tree", tree, ...(path ? ["--", path] : [])];
	return paths(await bytes(root, args, { signal })).map((record) => {
		const tab = record.indexOf("\t");
		const [mode, , blob, size] = record.slice(0, tab).split(/ +/);
		return { path: safePath(record.slice(tab + 1)), mode: mode!, blob: blob!, size: Number(size) };
	});
}

/**
 * Copy exactly the objects both trees reach into one pack in the capture, so it does not depend on the author's
 * repository. pack-objects reuses stored deltas without searching for new ones (--window=0 halved this step here) and writes
 * the index itself; fsck checks the result later.
 */
async function transferObjects(change: GitChange, source: string, signal?: AbortSignal) {
	await change.git(["pack-objects", "--revs", "--window=0", "-q", join(source, ".git", "objects", "pack", "pack")], {
		input: `${change.baseTree}\n${change.headTree}\n`,
		signal,
	});
	await text(source, ["prune-packed"], { signal });
}

/**
 * One patch for all regions. `--name-status` and the patch share Git's path order; a type change (T) is the one
 * status Git writes as two sections (deletion, then addition) for the same path.
 */
async function changedRegions(
	source: string,
	base: string,
	head: string,
	signal?: AbortSignal,
): Promise<ChangeRegion[]> {
	const [names, output] = await settledAll([
		bytes(source, [...DIFF, "--name-status", "-z", base, head], { signal }),
		bytes(source, [...DIFF, "--unified=0", base, head], { signal }),
	]);
	const records = paths(names);
	const changed: string[] = [];
	for (let i = 0; i + 1 < records.length; i += 2)
		changed.push(...(records[i] === "T" ? [records[i + 1]!, records[i + 1]!] : [records[i + 1]!]));
	const patch = output.toString("utf8");
	const starts = [...patch.matchAll(/^diff --git /gm)].map((match) => match.index);
	if (starts.length !== changed.length) throw new Error("Git patch and path inventory disagree");
	const regions: ChangeRegion[] = [];
	for (const [n, path] of changed.entries()) {
		const file = patch.slice(starts[n], starts[n + 1]);
		const hunks = [...file.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/gm)];
		if (!hunks.length)
			regions.push({
				id: hash(`${path}\0${file}`),
				path,
				kind: "non-text",
				oldStart: 0,
				oldCount: 0,
				newStart: 0,
				newCount: 0,
				patch: file,
			});
		for (const [i, hunk] of hunks.entries()) {
			const body = file.slice(i === 0 ? 0 : hunk.index, hunks[i + 1]?.index);
			regions.push({
				id: hash(`${path}\0${body}`),
				path,
				kind: "text",
				oldStart: Number(hunk[1]),
				oldCount: Number(hunk[2] ?? 1),
				newStart: Number(hunk[3]),
				newCount: Number(hunk[4] ?? 1),
				patch: body,
			});
		}
	}
	return regions;
}

async function changedPaths(source: string, base: string, head: string, signal?: AbortSignal) {
	const records = paths(
		await bytes(source, [...DIFF, "--find-renames", "--name-status", "-z", base, head], { signal }),
	);
	const changes: ReviewArtifact["changes"] = [];
	for (let i = 0; i < records.length; ) {
		const status = records[i++]!;
		const first = records[i++]!;
		if (status.startsWith("R") || status.startsWith("C"))
			changes.push({ status, path: records[i++]!, previousPath: first });
		else changes.push({ status, path: first });
	}
	return changes;
}

export async function captureIntent(request: ReviewRequest, signal?: AbortSignal): Promise<ReviewArtifact["intent"]> {
	if (!request.intent) return null;
	const origin = "path" in request.intent ? await realpath(resolve(request.cwd, request.intent.path)) : "request";
	const data = "text" in request.intent ? Buffer.from(request.intent.text) : await readFile(origin, { signal });
	signal?.throwIfAborted();
	if (!isUtf8(data)) throw new Error("Review intent must be UTF-8 text");
	return { origin, text: data.toString("utf8"), hash: hash(data) };
}

const identity = (change: GitChange) =>
	JSON.stringify([
		change.baseCommit,
		change.headCommit,
		change.baseTree,
		change.headTree,
		change.indexTree,
		change.indexEntries,
	]);

/**
 * Build a self-contained review repository. Git snapshots the target into the capture's own object store,
 * a pack copies the reachable objects, and checkout-index materializes the head tree for reviewers.
 */
export async function captureReview(
	request: ReviewRequest,
	destination: string,
	signal?: AbortSignal,
): Promise<ReviewArtifact> {
	request = structuredClone(request);
	if (request.paths)
		request.paths = [...new Set(request.paths.map((path) => safePath(path.replace(/\/$/, ""))))].sort();
	destination = canonical(destination);
	const startedAt = Date.now();
	const repository = await realpath(await text(request.cwd, ["rev-parse", "--show-toplevel"], { signal }));
	if (within(destination, repository)) throw new Error("Review artifacts must be outside the author's worktree");
	const intent = await captureIntent(request, signal);
	await mkdir(destination, { mode: 0o700 });
	const source = join(destination, "source");
	let change: GitChange | undefined;
	try {
		await mkdir(source);
		const format = await text(repository, ["rev-parse", "--show-object-format"], { signal });
		await text(source, ["init", "-q", "--template=", `--object-format=${format}`], { signal });
		const objects = join(source, ".git", "objects");
		change = await openGitChange(repository, request.target, { signal, objects });
		const { baseTree, headTree, baseCommit, headCommit } = change;
		await transferObjects(change, source, signal);
		await text(source, ["mktree"], { input: "", signal });
		const [before, after] = await settledAll([
			treeListing(source, baseTree, signal),
			treeListing(source, headTree, signal),
		]);
		const changedPathsList = paths(await bytes(source, [...DIFF, "--name-only", "-z", baseTree, headTree], { signal }));
		const reader = objectReader(source, {}, signal);
		const binaryPaths: string[] = [];
		const omissions: ReviewArtifact["omissions"] = [];
		try {
			for (const path of changedPathsList)
				for (const tree of [baseTree, headTree]) {
					const data = await reader.read(`${tree}:${path}`);
					if (data && classify("100644", data) === "binary" && !binaryPaths.includes(path)) binaryPaths.push(path);
				}
			for (const entry of after) {
				if (entry.mode === "160000")
					omissions.push({ path: entry.path, reason: "submodule pointer only; referenced content is not captured" });
				else if (entry.mode !== "120000" && entry.size < 1024) {
					const data = await reader.read(entry.blob);
					if (data && classify(entry.mode, data) === "lfs")
						omissions.push({ path: entry.path, reason: "lfs pointer only; referenced content is not captured" });
				}
			}
		} finally {
			await reader.close();
		}
		await mkdir(join(source, ".git", "info"), { recursive: true });
		await writeFile(
			join(source, ".git", "info", "attributes"),
			binaryPaths.map((path) => `${JSON.stringify(`/${path.replace(/[\\*?[\]]/g, "\\$&")}`)} -diff\n`).join(""),
		);
		await text(source, ["read-tree", headTree], { signal });
		await text(source, [...rawFlags(format), "checkout-index", "--all", "--force", "--index", "-q"], { signal });
		for (const entry of after) if (entry.mode === "160000") await mkdir(join(source, entry.path), { recursive: true });
		const commitOptions = {
			signal,
			env: {
				GIT_AUTHOR_NAME: "apple-pi review",
				GIT_AUTHOR_EMAIL: "review@localhost",
				GIT_COMMITTER_NAME: "apple-pi review",
				GIT_COMMITTER_EMAIL: "review@localhost",
			},
		};
		const baseRevision = await text(
			source,
			["-c", "commit.gpgsign=false", "commit-tree", baseTree, "-m", "Captured review base"],
			commitOptions,
		);
		const headRevision = await text(
			source,
			["-c", "commit.gpgsign=false", "commit-tree", headTree, "-p", baseRevision, "-m", "Captured review target"],
			commitOptions,
		);
		await text(source, ["update-ref", "refs/heads/base", baseRevision], { signal });
		await text(source, ["update-ref", "refs/heads/review", headRevision], { signal });
		await text(source, ["symbolic-ref", "HEAD", "refs/heads/review"], { signal });
		// Mutable sources are snapshotted again after materialization; an observed change refuses the capture.
		const again = await openGitChange(repository, request.target, { signal, objects });
		await again.close();
		if (
			identity(again) !== identity(change) ||
			JSON.stringify(intent) !== JSON.stringify(await captureIntent(request, signal))
		)
			throw new Error("Source changed during capture; capture the review again");
		const scope = request.paths ?? [];
		const includes = (path: string) =>
			scope.length === 0 || scope.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
		for (const prefix of scope)
			if (![...before, ...after].some((entry) => entry.path === prefix || entry.path.startsWith(`${prefix}/`)))
				throw new Error(`Requested review path does not exist in either snapshot: ${JSON.stringify(prefix)}`);
		const patch = await bytes(
			source,
			["--literal-pathspecs", ...DIFF, "--binary", baseTree, headTree, "--", ...scope],
			{ signal },
		);
		const allRegions = await changedRegions(source, baseTree, headTree, signal);
		const regions = allRegions.filter((region) => includes(region.path));
		const changes = (await changedPaths(source, baseTree, headTree, signal)).filter(
			(change) => includes(change.path) || (change.previousPath !== undefined && includes(change.previousPath)),
		);
		for (const entry of after.filter((file) => file.mode === "120000")) {
			try {
				const target = canonical(join(source, entry.path));
				if (!within(target, source))
					omissions.push({
						path: entry.path,
						reason: "Symlink destination is outside the capture; only its link text is frozen",
					});
				else if (!(await lstat(target).catch(absent)))
					omissions.push({
						path: entry.path,
						reason: "Symlink destination is not captured; only its link text is frozen",
					});
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ELOOP") throw error;
				omissions.push({ path: entry.path, reason: "Symlink cycle; captured link text does not resolve to content" });
			}
		}
		for (const path of new Set(allRegions.filter((region) => !includes(region.path)).map((region) => region.path)))
			omissions.push({ path, reason: "Outside the requested review paths; retained as context" });
		const artifact: ReviewArtifact = {
			version: 1,
			request,
			repository,
			commonDirectory: await realpath(change.commonDirectory),
			baseCommit,
			headCommit,
			baseTree,
			headTree,
			files: after.map(({ size: _, ...entry }) => entry),
			index: change.indexTree,
			intent,
			configuration: reviewConfiguration(source),
			regions,
			changes,
			omissions,
			patchHash: hash(patch),
			digest: "",
			source,
			baseRevision,
			headRevision,
			startedAt,
			capturedAt: Date.now(),
		};
		artifact.digest = artifactDigest(artifact);
		artifact.label = await reviewLabel(change, repository, request.target, signal);
		await writeFile(join(destination, "change.patch"), patch);
		await writeFile(join(destination, "manifest.json"), `${JSON.stringify(artifact, null, 2)}\n`);
		await change.close();
		// fsck runs with full verification before recovery and decisions.
		await verifyCapturedSource(artifact, signal);
		if (JSON.stringify(artifact.configuration) !== JSON.stringify(reviewConfiguration(source)))
			throw new Error("Review configuration changed during capture; capture the review again");
		return artifact;
	} catch (error) {
		// Close first: it stops and waits for the change's Git work before its storage disappears.
		await change?.close();
		await rm(destination, { recursive: true, force: true });
		throw error;
	}
}

import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { type GitOptions, gitBytes } from "../../shared/src/git.js";
import { canonical, within } from "../../shared/src/real-path.js";
import { blobStore, gitObjects } from "./git-objects.js";
import { reviewConfiguration } from "./policy.js";
import type { ChangeRegion, ReviewArtifact, ReviewRequest, ReviewTarget, SourceEntry } from "./types.js";

type BlobStore = Awaited<ReturnType<typeof blobStore>>;
type EntryReference = Pick<SourceEntry, "path" | "mode" | "blob">;

const ENV: NodeJS.ProcessEnv = {
	GIT_DIR: undefined,
	GIT_WORK_TREE: undefined,
	GIT_INDEX_FILE: undefined,
	GIT_COMMON_DIR: undefined,
	GIT_OBJECT_DIRECTORY: undefined,
	GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
	GIT_CONFIG_COUNT: undefined,
	GIT_CONFIG_PARAMETERS: undefined,
	GIT_NO_REPLACE_OBJECTS: "1",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_NO_LAZY_FETCH: "1",
	GIT_TERMINAL_PROMPT: "0",
};
const FLAGS = ["--no-pager", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"];
const DIFF = ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--no-color"];
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

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

async function verifyCapturedGit(artifact: ReviewArtifact, signal?: AbortSignal): Promise<void> {
	if (artifactDigest(artifact) !== artifact.digest) throw new Error("Review manifest identity changed");
	if (hash(await readFile(join(dirname(artifact.source), "change.patch"))) !== artifact.patchHash)
		throw new Error("Captured patch changed");
	if (
		(await text(artifact.source, ["rev-parse", "HEAD"], { signal })) !== artifact.headRevision ||
		(await text(artifact.source, ["rev-parse", "base"], { signal })) !== artifact.baseRevision
	)
		throw new Error("Captured Git revisions changed");
	await text(artifact.source, ["fsck", "--no-reflogs"], { signal });
	if (
		hash(
			await bytes(
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
			),
		) !== artifact.patchHash
	)
		throw new Error("Captured comparison changed");
}

export async function verifyArtifact(artifact: ReviewArtifact, signal?: AbortSignal): Promise<void> {
	await verifyCapturedGit(artifact, signal);
	for await (const { entry, data: expected } of entryContents(artifact.source, artifact.files, signal)) {
		const path = join(artifact.source, safePath(entry.path));
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
		if (mode === "160000") continue;
		const data = mode === "120000" ? await readlink(path, { encoding: "buffer" }) : await readFile(path);
		if (!data.equals(expected)) throw new Error(`Captured source changed: ${entry.path}`);
	}
}

export async function readCapturedSource(
	artifact: ReviewArtifact,
	options: { path?: string; side?: "before" | "after" } = {},
	signal?: AbortSignal,
) {
	const path = options.path === undefined ? undefined : safePath(options.path);
	await verifyCapturedGit(artifact, signal);
	const side = options.side ?? "after";
	const tree = side === "before" ? artifact.baseTree : artifact.headTree;
	const identity = { artifact: artifact.digest, side, tree };
	const entries = await treeReferences(artifact.source, tree, signal);
	if (path === undefined) return { ...identity, kind: "files" as const, files: entries };
	const entry = entries.find((entry) => entry.path === path);
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

function bytes(cwd: string, args: string[], options: GitOptions = {}) {
	return gitBytes(cwd, [...FLAGS, ...args], { ...options, env: { ...ENV, ...options.env } });
}
async function text(cwd: string, args: string[], options?: GitOptions) {
	return (await bytes(cwd, args, options)).toString("utf8").replace(/\n$/, "");
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
function classify(mode: string, data: Buffer): SourceEntry["content"] {
	if (mode === "120000") return "symlink";
	if (mode === "160000") return "submodule";
	if (data.subarray(0, 43).toString() === "version https://git-lfs.github.com/spec/v1\n") return "lfs";
	return data.includes(0) || !isUtf8(data) ? "binary" : "text";
}
async function absent(error: unknown): Promise<undefined> {
	if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ENOTDIR")
		throw error;
	return undefined;
}

async function store(blobs: BlobStore, path: string, mode: string, data: Buffer): Promise<SourceEntry> {
	const blob = mode === "160000" ? data.toString() : await blobs.put(data);
	return { path: safePath(path), mode, blob, content: classify(mode, data) };
}

async function* entryContents(root: string, entries: EntryReference[], signal?: AbortSignal) {
	const reader = gitObjects(
		root,
		entries.filter((entry) => entry.mode !== "160000").map((entry) => entry.blob),
		ENV,
		signal,
	);
	try {
		for (const entry of entries) {
			if (entry.mode === "160000") yield { entry, data: Buffer.from(entry.blob) };
			else {
				const next = await reader.next();
				if (next.done) throw new Error(`Missing captured blob: ${entry.path}`);
				yield { entry, data: next.value };
			}
		}
		await reader.next();
	} finally {
		await reader.return(undefined);
	}
}

async function copyEntries(root: string, entries: EntryReference[], blobs: BlobStore, signal?: AbortSignal) {
	const result: SourceEntry[] = [];
	for await (const { entry, data } of entryContents(root, entries, signal))
		result.push(await store(blobs, entry.path, entry.mode, data));
	return result;
}

async function treeReferences(root: string, tree: string, signal?: AbortSignal): Promise<EntryReference[]> {
	return paths(await bytes(root, ["ls-tree", "-rz", "--full-tree", tree], { signal })).map((record) => {
		const tab = record.indexOf("\t");
		const [mode, , blob] = record.slice(0, tab).split(" ");
		return { path: safePath(record.slice(tab + 1)), mode: mode!, blob: blob! };
	});
}

async function treeEntries(root: string, tree: string, blobs: BlobStore, signal?: AbortSignal): Promise<SourceEntry[]> {
	return copyEntries(root, await treeReferences(root, tree, signal), blobs, signal);
}

async function indexEntries(root: string, signal?: AbortSignal) {
	return paths(await bytes(root, ["ls-files", "--stage", "-z"], { signal })).map((record) => {
		const tab = record.indexOf("\t");
		const [mode, blob, stage] = record.slice(0, tab).split(" ");
		if (stage !== "0") throw new Error("Resolve index conflicts before capturing a review");
		return { path: safePath(record.slice(tab + 1)), mode: mode!, blob: blob! };
	});
}

async function stagedEntries(root: string, blobs: BlobStore, signal?: AbortSignal): Promise<SourceEntry[]> {
	return copyEntries(root, await indexEntries(root, signal), blobs, signal);
}

async function workingEntries(root: string, blobs: BlobStore, signal?: AbortSignal): Promise<SourceEntry[]> {
	const tracked = new Map((await indexEntries(root, signal)).map((entry) => [entry.path, entry]));
	const names = new Set([
		...tracked.keys(),
		...paths(await bytes(root, ["ls-files", "--others", "--exclude-standard", "-z"], { signal })),
	]);
	const entries: SourceEntry[] = [];
	for (const path of [...names].sort()) {
		signal?.throwIfAborted();
		safePath(path);
		// A tracked directory replaced by a link deletes its old children; reading through it would capture unrelated bytes.
		const parts = path.split("/");
		let parentPresent = true;
		for (let i = 1; i < parts.length; i++) {
			const parent = await lstat(join(root, ...parts.slice(0, i))).catch(absent);
			if (!parent?.isDirectory()) {
				parentPresent = false;
				break;
			}
		}
		if (!parentPresent) continue;
		const full = join(root, path);
		const stat = await lstat(full).catch(absent);
		if (!stat) continue;
		if (stat.isDirectory()) {
			if (tracked.get(path)?.mode === "160000") {
				const top = await realpath(await text(full, ["rev-parse", "--show-toplevel"], { signal }));
				const commit =
					top === (await realpath(full))
						? await text(full, ["rev-parse", "--verify", "HEAD^{commit}"], { signal })
						: tracked.get(path)!.blob;
				entries.push(await store(blobs, path, "160000", Buffer.from(commit)));
			}
			continue;
		}
		if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error(`Unsupported source file: ${JSON.stringify(path)}`);
		const mode = stat.isSymbolicLink() ? "120000" : stat.mode & 0o111 ? "100755" : "100644";
		const data = stat.isSymbolicLink() ? await readlink(full, { encoding: "buffer" }) : await readFile(full);
		entries.push(await store(blobs, path, mode, data));
	}
	return entries;
}

async function writeTree(source: string, entries: SourceEntry[], signal?: AbortSignal): Promise<string> {
	await text(source, ["read-tree", "--empty"], { signal });
	await text(source, ["update-index", "-z", "--index-info"], {
		input: entries.map((entry) => `${entry.mode} ${entry.blob}\t${entry.path}\0`).join(""),
		signal,
	});
	return entries.length ? text(source, ["write-tree"], { signal }) : text(source, ["mktree"], { input: "", signal });
}

async function materialize(source: string, entries: SourceEntry[], signal?: AbortSignal) {
	for await (const { entry, data } of entryContents(source, entries, signal)) {
		signal?.throwIfAborted();
		const path = join(source, safePath(entry.path));
		let parent = source;
		for (const part of entry.path.split("/").slice(0, -1)) {
			parent = join(parent, part);
			const existing = await lstat(parent).catch(absent);
			if (existing && !existing.isDirectory()) throw new Error(`Conflicting source paths: ${entry.path}`);
			if (!existing) await mkdir(parent);
		}
		if (entry.mode === "160000") {
			await mkdir(path, { recursive: true });
			continue;
		}
		if (entry.mode === "120000") await symlink(data.toString(), path);
		else {
			await writeFile(path, data, { flag: "wx" });
			await chmod(path, entry.mode === "100755" ? 0o755 : 0o644);
		}
	}
}

async function changedRegions(
	source: string,
	base: string,
	head: string,
	signal?: AbortSignal,
): Promise<ChangeRegion[]> {
	const changed = paths(await bytes(source, [...DIFF, "--name-only", "-z", base, head], { signal }));
	const regions: ChangeRegion[] = [];
	for (const path of changed) {
		const patch = (
			await bytes(source, ["--literal-pathspecs", ...DIFF, "--unified=0", base, head, "--", path], { signal })
		).toString("utf8");
		const hunks = [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/gm)];
		if (!hunks.length)
			regions.push({
				id: hash(`${path}\0${patch}`),
				path,
				kind: "non-text",
				oldStart: 0,
				oldCount: 0,
				newStart: 0,
				newCount: 0,
				patch,
			});
		for (const [i, hunk] of hunks.entries()) {
			const body = patch.slice(i === 0 ? 0 : hunk.index, hunks[i + 1]?.index);
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

async function resolveTarget(root: string, target: ReviewTarget, signal?: AbortSignal) {
	const commit = (ref: string) =>
		text(root, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], { signal });
	if (target.kind === "commit") {
		const headCommit = await commit(target.commit);
		const parents = (await text(root, ["rev-list", "--parents", "-n", "1", headCommit], { signal }))
			.split(" ")
			.slice(1);
		if (parents.length > 1 && !target.parent) throw new Error("A merge commit needs an explicit parent comparison");
		const baseCommit = target.parent ? await commit(target.parent) : (parents[0] ?? null);
		if (baseCommit && !parents.includes(baseCommit))
			throw new Error("The selected comparison is not a parent of this commit; use a range for another base");
		return { baseCommit, headCommit };
	}
	const headCommit = await commit(target.kind === "range" || target.kind === "branch" ? target.head : "HEAD");
	let baseCommit = target.kind === "staged" ? headCommit : await commit(target.base);
	if (target.kind === "branch") {
		const bases = (await text(root, ["merge-base", "--all", baseCommit, headCommit], { signal }))
			.split("\n")
			.filter(Boolean);
		if (bases.length !== 1)
			throw new Error("A branch review requires one unambiguous merge base; choose an explicit range");
		baseCommit = bases[0]!;
	}
	return { baseCommit, headCommit };
}

async function captureIntent(request: ReviewRequest): Promise<ReviewArtifact["intent"]> {
	if (!request.intent) return null;
	const origin = "path" in request.intent ? await realpath(resolve(request.cwd, request.intent.path)) : "request";
	const data = "text" in request.intent ? Buffer.from(request.intent.text) : await readFile(origin);
	if (!isUtf8(data)) throw new Error("Review intent must be UTF-8 text");
	return { origin, text: data.toString("utf8"), hash: hash(data) };
}

/** Build a self-contained review repository; only its private index and objects are written. */
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
	const commonDirectory = await realpath(
		resolve(repository, await text(repository, ["rev-parse", "--git-common-dir"], { signal })),
	);
	const { baseCommit, headCommit } = await resolveTarget(repository, request.target, signal);
	const intent = await captureIntent(request);
	const mutable = request.target.kind === "staged" || request.target.kind === "working-tree";
	const index = mutable ? await indexEntries(repository, signal) : null;
	await mkdir(destination, { mode: 0o700 });
	const source = join(destination, "source");
	try {
		await mkdir(source);
		const format = await text(repository, ["rev-parse", "--show-object-format"], { signal });
		await text(source, ["init", "-q", "--template=", `--object-format=${format}`], { signal });
		const blobs = await blobStore(source, format, ENV, signal);
		const before = baseCommit ? await treeEntries(repository, baseCommit, blobs, signal) : [];
		const captureEntries =
			request.target.kind === "staged"
				? stagedEntries
				: request.target.kind === "working-tree"
					? workingEntries
					: undefined;
		const files = captureEntries
			? await captureEntries(repository, blobs, signal)
			: await treeEntries(repository, headCommit, blobs, signal);
		await blobs.flush();
		const binaryPaths = [
			...new Set([...before, ...files].filter((entry) => entry.content === "binary").map((entry) => entry.path)),
		];
		await mkdir(join(source, ".git", "info"), { recursive: true });
		await writeFile(
			join(source, ".git", "info", "attributes"),
			binaryPaths.map((path) => `${JSON.stringify(`/${path.replace(/[\\*?[\]]/g, "\\$&")}`)} -diff\n`).join(""),
		);
		const baseTree = await writeTree(source, before, signal);
		const headTree = await writeTree(source, files, signal);
		await materialize(source, files, signal);
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
		if (
			captureEntries &&
			(JSON.stringify(files) !== JSON.stringify(await captureEntries(repository, blobs, signal)) ||
				JSON.stringify({ baseCommit, headCommit }) !==
					JSON.stringify(await resolveTarget(repository, request.target, signal)))
		)
			throw new Error("Source changed during capture; capture the review again");
		if (
			JSON.stringify(intent) !== JSON.stringify(await captureIntent(request)) ||
			(mutable && JSON.stringify(index) !== JSON.stringify(await indexEntries(repository, signal)))
		)
			throw new Error("Source changed during capture; capture the review again");
		await blobs.close();
		const scope = request.paths?.map((path) => safePath(path.replace(/\/$/, ""))) ?? [];
		const includes = (path: string) =>
			scope.length === 0 || scope.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
		for (const prefix of scope)
			if (![...before, ...files].some((entry) => entry.path === prefix || entry.path.startsWith(`${prefix}/`)))
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
		const omissions = files
			.filter((entry) => entry.content === "submodule" || entry.content === "lfs")
			.map((entry) => ({
				path: entry.path,
				reason: `${entry.content} pointer only; referenced content is not captured`,
			}));
		for (const entry of files.filter((file) => file.content === "symlink")) {
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
		const identity = {
			version: 1 as const,
			request,
			repository,
			commonDirectory,
			baseCommit,
			headCommit,
			baseTree,
			headTree,
			files,
			index,
			intent,
			configuration: reviewConfiguration(source),
			regions,
			changes,
			omissions,
			patchHash: hash(patch),
		};
		const artifact: ReviewArtifact = {
			...identity,
			digest: "",
			source,
			baseRevision,
			headRevision,
			startedAt,
			capturedAt: Date.now(),
		};
		artifact.digest = artifactDigest(artifact);
		await writeFile(join(destination, "change.patch"), patch);
		await writeFile(join(destination, "manifest.json"), `${JSON.stringify(artifact, null, 2)}\n`);
		await verifyArtifact(artifact, signal);
		if (JSON.stringify(artifact.configuration) !== JSON.stringify(reviewConfiguration(source)))
			throw new Error("Review configuration changed during capture; capture the review again");
		return artifact;
	} catch (error) {
		await rm(destination, { recursive: true, force: true });
		throw error;
	}
}

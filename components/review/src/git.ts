import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ReviewInput, ReviewItem, ReviewItemStatus, ReviewPreview, ReviewSource } from "./types.js";

const MAX_GIT_OUTPUT = 64 * 1024 * 1024;

export class ReviewInputError extends Error {
	constructor(message: string, readonly code: string) {
		super(message);
		this.name = "ReviewInputError";
	}
}

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function runGit(root: string, args: string[], input?: Buffer): Buffer {
	try {
		return execFileSync("git", ["-C", root, ...args], {
			encoding: "buffer",
			input,
			maxBuffer: MAX_GIT_OUTPUT,
			stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
		});
	} catch (error) {
		const stderr = (error as { stderr?: Buffer }).stderr?.toString("utf8").trim();
		throw new ReviewInputError(stderr || `git ${args.join(" ")} failed`, "git_error");
	}
}

function tryGit(root: string, args: string[]): Buffer | undefined {
	try {
		return runGit(root, args);
	} catch {
		return undefined;
	}
}

export function reviewRepositoryRoot(input: string): string {
	const root = runGit(input, ["rev-parse", "--show-toplevel"]).toString("utf8").trim();
	if (!root) throw new ReviewInputError("Review requires a Git working tree", "not_git_repository");
	return realpathSync(root);
}

function isWithin(base: string, target: string): boolean {
	const rel = relative(base, target);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function gitCommonDirectory(root: string): string {
	const value = runGit(root, ["rev-parse", "--git-common-dir"]).toString("utf8").trim();
	if (!value) throw new ReviewInputError("Could not resolve the Git common directory", "git_identity");
	return realpathSync(isAbsolute(value) ? value : resolve(root, value));
}

/**
 * Resolve an agent-selected review root without granting arbitrary filesystem
 * traversal. Targets may be inside the current trusted directory/repository or
 * another linked worktree of the current repository.
 */
export function resolveReviewTargetRoot(cwd: string, requestedRoot?: string): string {
	if (!requestedRoot?.trim()) return reviewRepositoryRoot(cwd);
	const raw = requestedRoot.trim().replace(/^@/, "");
	const target = reviewRepositoryRoot(resolve(cwd, raw));
	const currentRepository = (() => {
		try {
			return reviewRepositoryRoot(cwd);
		} catch {
			return undefined;
		}
	})();
	const trustedBase = currentRepository ?? realpathSync(cwd);
	if (isWithin(trustedBase, target)) return target;
	const targetCommonDirectory = gitCommonDirectory(target);
	if (isWithin(trustedBase, targetCommonDirectory)) return target;
	if (currentRepository && gitCommonDirectory(currentRepository) === targetCommonDirectory) return target;
	throw new ReviewInputError(
		`Review root ${target} is outside ${trustedBase} and is not a linked worktree of the current repository`,
		"unauthorized_root",
	);
}

function assertRef(ref: string, label: string): void {
	if (!ref || ref.startsWith("-")) throw new ReviewInputError(`${label} must be a non-option Git ref`, "invalid_ref");
}

function resolveCommit(root: string, ref: string, label: string): string {
	assertRef(ref, label);
	const resolved = tryGit(root, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])?.toString("utf8").trim();
	if (!resolved) throw new ReviewInputError(`${label} is not a valid commit ref: ${ref}`, "invalid_ref");
	return resolved;
}

interface NameStatus {
	status: ReviewItemStatus;
	oldPath?: string;
	path: string;
}

function mapStatus(raw: string): ReviewItemStatus {
	switch (raw[0]) {
		case "A": return "added";
		case "D": return "deleted";
		case "R": return "renamed";
		case "C": return "copied";
		default: return "modified";
	}
}

function parseNameStatus(output: Buffer): NameStatus[] {
	const tokens = output.toString("utf8").split("\0");
	if (tokens[tokens.length - 1] === "") tokens.pop();
	const entries: NameStatus[] = [];
	for (let index = 0; index < tokens.length;) {
		const raw = tokens[index++];
		if (!raw) continue;
		const status = mapStatus(raw);
		if (status === "renamed" || status === "copied") {
			const oldPath = tokens[index++];
			const path = tokens[index++];
			if (oldPath === undefined || path === undefined) throw new ReviewInputError("Malformed Git rename status", "git_output");
			entries.push({ status, oldPath, path });
		} else {
			const path = tokens[index++];
			if (path === undefined) throw new ReviewInputError("Malformed Git name status", "git_output");
			entries.push({ status, path });
		}
	}
	return entries;
}

function lineCounts(diff: string): { insertions: number; deletions: number } {
	let insertions = 0;
	let deletions = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) insertions++;
		else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
	}
	return { insertions, deletions };
}

function logicalItemId(source: ReviewSource, status: ReviewItemStatus, oldPath: string | undefined, path: string): string {
	return sha256([source.mode, status, oldPath ?? "", path].join("\0"));
}

function item(source: ReviewSource, entry: NameStatus, diff: string, binary = false, fingerprintMaterial?: Buffer): ReviewItem {
	const counts = lineCounts(diff);
	return {
		id: logicalItemId(source, entry.status, entry.oldPath, entry.path),
		path: entry.path,
		...(entry.oldPath && { oldPath: entry.oldPath }),
		status: entry.status,
		diff,
		insertions: counts.insertions,
		deletions: counts.deletions,
		fingerprint: fingerprintMaterial ? sha256(Buffer.concat([Buffer.from(diff), Buffer.from([0]), fingerprintMaterial])) : sha256(diff),
		binary: binary || /(?:GIT binary patch|Binary files .* differ)/.test(diff),
	};
}

function assertRepoPath(root: string, path: string): string {
	const absolute = resolve(root, path);
	const rel = relative(root, absolute).split(sep).join("/");
	if (!rel || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
		throw new ReviewInputError(`Git returned a path outside the repository: ${path}`, "unsafe_path");
	}
	return absolute;
}

function quoteDiffPath(path: string): string {
	return path.includes("\n") || path.includes("\t") || path.includes(" ") ? JSON.stringify(path) : path;
}

function untrackedItem(root: string, source: ReviewSource, path: string): ReviewItem {
	const absolute = assertRepoPath(root, path);
	let stat: ReturnType<typeof lstatSync>;
	try {
		stat = lstatSync(absolute);
	} catch {
		throw new ReviewInputError(`Untracked review path disappeared: ${path}`, "workspace_changed");
	}
	let content: Buffer;
	let gitMode: string;
	if (stat.isSymbolicLink()) {
		content = readlinkSync(absolute, { encoding: "buffer" });
		gitMode = "120000";
	} else if (stat.isFile()) {
		content = readFileSync(absolute);
		gitMode = stat.mode & 0o111 ? "100755" : "100644";
	} else {
		const metadata = Buffer.from(`${stat.mode}:${stat.size}`);
		return item(source, { path, status: "untracked" }, `diff --git a/${quoteDiffPath(path)} b/${quoteDiffPath(path)}\nUnsupported non-file workspace entry\n`, true, metadata);
	}
	const utf8 = content.toString("utf8");
	if (content.includes(0) || !Buffer.from(utf8, "utf8").equals(content)) {
		const digest = sha256(content);
		return item(source, { path, status: "untracked" }, [
			`diff --git a/${quoteDiffPath(path)} b/${quoteDiffPath(path)}`,
			`new file mode ${gitMode}`,
			`Binary file SHA-256: ${digest}`,
			"",
		].join("\n"), true, content);
	}
	const text = utf8;
	const lines = text.split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	const body = lines.map((line) => `+${line}`).join("\n");
	const diff = [
		`diff --git a/${quoteDiffPath(path)} b/${quoteDiffPath(path)}`,
		`new file mode ${gitMode}`,
		"--- /dev/null",
		`+++ b/${quoteDiffPath(path)}`,
		`@@ -0,0 +1,${lines.length} @@`,
		body,
		...(text && !text.endsWith("\n") ? ["\\ No newline at end of file"] : []),
		"",
	].join("\n");
	return item(source, { path, status: "untracked" }, diff, false, content);
}

function untrackedPaths(root: string): string[] {
	return runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]).toString("utf8").split("\0").filter(Boolean);
}

function diffForPaths(root: string, base: string, head: string | undefined, entry: NameStatus): string {
	const range = head ? [base, head] : [base];
	const paths = entry.oldPath && entry.oldPath !== entry.path ? [entry.oldPath, entry.path] : [entry.path];
	return runGit(root, ["diff", "--no-ext-diff", "--no-textconv", "--binary", "--unified=20", ...range, "--", ...paths]).toString("utf8");
}

function emptyTree(root: string): string {
	return runGit(root, ["hash-object", "-t", "tree", "--stdin"], Buffer.alloc(0)).toString("utf8").trim();
}

function inputHash(source: ReviewSource, base: string | undefined, head: string | undefined, items: ReviewItem[]): string {
	const identities = [...items]
		.sort((left, right) => left.id.localeCompare(right.id))
		.map((entry) => [entry.id, entry.fingerprint]);
	return sha256(JSON.stringify({ source, base, head, identities }));
}

export function resolveReviewInput(projectRootInput: string, source: ReviewSource): ReviewInput {
	const projectRoot = reviewRepositoryRoot(projectRootInput);
	let resolvedBase: string | undefined;
	let resolvedHead: string | undefined;
	let entries: NameStatus[] = [];
	let diffBase: string | undefined;
	let diffHead: string | undefined;
	let includeUntracked = false;

	if (source.mode === "workspace") {
		includeUntracked = true;
		resolvedHead = tryGit(projectRoot, ["rev-parse", "--verify", "HEAD"])?.toString("utf8").trim();
		if (resolvedHead) {
			resolvedBase = resolvedHead;
			diffBase = resolvedHead;
			entries = parseNameStatus(runGit(projectRoot, ["diff", "--name-status", "-z", "--find-renames", resolvedHead, "--", "."]));
		} else {
			const paths = runGit(projectRoot, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
				.toString("utf8").split("\0").filter(Boolean);
			const items = paths.map((path) => untrackedItem(projectRoot, source, path));
			return { projectRoot, source, items, inputHash: inputHash(source, undefined, undefined, items) };
		}
	} else if (source.mode === "range") {
		const from = resolveCommit(projectRoot, source.from, "from");
		resolvedHead = resolveCommit(projectRoot, source.to, "to");
		resolvedBase = runGit(projectRoot, ["merge-base", from, resolvedHead]).toString("utf8").trim();
		if (!resolvedBase) throw new ReviewInputError("Range refs have no merge base", "no_merge_base");
		diffBase = resolvedBase;
		diffHead = resolvedHead;
		entries = parseNameStatus(runGit(projectRoot, ["diff", "--name-status", "-z", "--find-renames", resolvedBase, resolvedHead, "--", "."]));
	} else {
		resolvedHead = resolveCommit(projectRoot, source.commit, "commit");
		const parentLine = runGit(projectRoot, ["rev-list", "--parents", "-n", "1", resolvedHead]).toString("utf8").trim().split(/\s+/);
		resolvedBase = parentLine[1] ?? emptyTree(projectRoot);
		diffBase = resolvedBase;
		diffHead = resolvedHead;
		entries = parseNameStatus(runGit(projectRoot, ["diff", "--name-status", "-z", "--find-renames", resolvedBase, resolvedHead, "--", "."]));
	}

	const items = entries.map((entry) => item(source, entry, diffForPaths(projectRoot, diffBase!, diffHead, entry)));
	if (includeUntracked) items.push(...untrackedPaths(projectRoot).map((path) => untrackedItem(projectRoot, source, path)));
	return {
		projectRoot,
		source,
		...(resolvedBase && { resolvedBase }),
		...(resolvedHead && { resolvedHead }),
		items,
		inputHash: inputHash(source, resolvedBase, resolvedHead, items),
	};
}

export function previewReviewInput(projectRoot: string, source: ReviewSource): ReviewPreview {
	const input = resolveReviewInput(projectRoot, source);
	const reviewable = input.items.filter((entry) => !entry.binary);
	const waived = input.items.filter((entry) => entry.binary).map((entry) => ({ item: entry, reason: "binary or non-text change" }));
	return { ...input, reviewable, waived };
}

export interface MaterializedReviewTree {
	root: string;
	cleanup: () => void;
}

export function materializeReviewTree(input: ReviewInput): MaterializedReviewTree {
	if (input.source.mode === "workspace") return { root: input.projectRoot, cleanup: () => {} };
	if (!input.resolvedHead) throw new ReviewInputError("Commit-backed review input has no resolved head", "invalid_input");
	const directory = mkdtempSync(join(tmpdir(), "review-tree-"));
	const checkout = join(directory, "checkout");
	const archive = join(directory, "tree.tar");
	mkdirSync(checkout, { mode: 0o700 });
	try {
		runGit(input.projectRoot, ["archive", "--format=tar", `--output=${archive}`, input.resolvedHead]);
		execFileSync("tar", ["-xf", archive, "-C", checkout], { encoding: "buffer", maxBuffer: MAX_GIT_OUTPUT, stdio: ["ignore", "pipe", "pipe"] });
		unlinkSync(archive);
		return { root: checkout, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		if (error instanceof ReviewInputError) throw error;
		const stderr = (error as { stderr?: Buffer }).stderr?.toString("utf8").trim();
		throw new ReviewInputError(stderr || "Could not materialize the sealed review tree", "materialize_failed");
	}
}

export function assertReviewInputUnchanged(expected: ReviewInput): void {
	const actual = resolveReviewInput(expected.projectRoot, expected.source);
	if (actual.inputHash !== expected.inputHash) {
		throw new ReviewInputError("Review input changed while the run was active", "workspace_conflict");
	}
}

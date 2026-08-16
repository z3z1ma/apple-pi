import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import type { ChangedPath, WorkspaceEntry, WorkspaceSnapshot } from "./types.js";

export class WorkspaceError extends Error {
	constructor(message: string, readonly code: string) {
		super(message);
		this.name = "WorkspaceError";
	}
}

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function git(projectRoot: string, args: string[], maxBuffer = 16 * 1024 * 1024): Buffer {
	try {
		return execFileSync("git", ["-C", projectRoot, ...args], { encoding: "buffer", maxBuffer, stdio: ["ignore", "pipe", "pipe"] });
	} catch (error) {
		const stderr = (error as { stderr?: Buffer }).stderr?.toString("utf8").trim();
		throw new WorkspaceError(stderr || `git ${args.join(" ")} failed`, "git_error");
	}
}

function byteSort(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function assertRepositoryReady(projectRoot: string): void {
	if (git(projectRoot, ["rev-parse", "--is-inside-work-tree"]).toString("utf8").trim() !== "true") {
		throw new WorkspaceError("Ralph requires a Git working tree", "not_git_repository");
	}
	git(projectRoot, ["rev-parse", "--verify", "HEAD"]);
	const unmerged = git(projectRoot, ["diff", "--name-only", "--diff-filter=U", "-z"]);
	if (unmerged.length > 0) throw new WorkspaceError("Workspace has unmerged paths", "unmerged_paths");
	for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"]) {
		const path = git(projectRoot, ["rev-parse", "--git-path", marker]).toString("utf8").trim();
		if (path && existsSync(resolve(projectRoot, path))) throw new WorkspaceError(`Git operation in progress: ${marker}`, "git_operation_in_progress");
	}
	for (const marker of ["rebase-apply", "rebase-merge"]) {
		const path = git(projectRoot, ["rev-parse", "--git-path", marker]).toString("utf8").trim();
		if (path && existsSync(resolve(projectRoot, path))) throw new WorkspaceError(`Git operation in progress: ${marker}`, "git_operation_in_progress");
	}
}

export function assertCleanWorkspace(projectRootInput: string): void {
	const projectRoot = realpathSync(projectRootInput);
	assertRepositoryReady(projectRoot);
	const status = git(projectRoot, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]);
	if (status.length > 0) {
		throw new WorkspaceError("Workspace must be clean before starting a Ralph run", "dirty_workspace");
	}
}

export function captureWorkspace(projectRootInput: string): WorkspaceSnapshot {
	const projectRoot = realpathSync(projectRootInput);
	assertRepositoryReady(projectRoot);
	const head = git(projectRoot, ["rev-parse", "HEAD"]).toString("utf8").trim();
	const branch = git(projectRoot, ["branch", "--show-current"]).toString("utf8").trim();
	const index = git(projectRoot, ["ls-files", "--stage", "-z"]);
	if (/(?:^|\0)160000\s/.test(index.toString("utf8"))) throw new WorkspaceError("Ralph does not execute in workspaces containing Git submodules", "unsupported_gitlink");
	const indexHash = sha256(index);
	const statusHash = sha256(git(projectRoot, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]));
	const repositoryPaths = git(projectRoot, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
		.toString("utf8").split("\0").filter(Boolean);
	const ignoredLedgerPaths = git(projectRoot, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", ".ledger"])
		.toString("utf8").split("\0").filter(Boolean);
	const paths = [...new Set([...repositoryPaths, ...ignoredLedgerPaths])].sort(byteSort);
	const entries: WorkspaceEntry[] = [];
	for (const path of paths) {
		const absolute = resolve(projectRoot, path);
		if (!existsSync(absolute)) continue;
		for (let ancestor = dirname(absolute); ancestor !== projectRoot; ancestor = dirname(ancestor)) {
			if (existsSync(resolve(ancestor, ".git"))) throw new WorkspaceError(`Ralph does not execute across nested Git repository: ${relative(projectRoot, ancestor)}`, "unsupported_gitlink");
			if (dirname(ancestor) === ancestor) break;
		}
		const stat = lstatSync(absolute);
		const normalized = relative(projectRoot, absolute).split(sep).join("/");
		if (stat.isSymbolicLink()) {
			entries.push({ path: normalized, kind: "symlink", mode: stat.mode, size: stat.size, digest: sha256(readlinkSync(absolute)) });
		} else if (stat.isFile()) {
			entries.push({ path: normalized, kind: "file", mode: stat.mode, size: stat.size, digest: sha256(readFileSync(absolute)) });
		} else if (stat.isDirectory()) {
			if (existsSync(resolve(absolute, ".git"))) throw new WorkspaceError(`Ralph does not execute across nested Git repository: ${normalized}`, "unsupported_gitlink");
			entries.push({ path: normalized, kind: "directory", mode: stat.mode, size: stat.size, digest: sha256(`${stat.mode}:${stat.size}`) });
		}
	}
	const hash = sha256(JSON.stringify({ head, branch, indexHash, statusHash, entries }));
	return { head, branch, indexHash, statusHash, entries, hash };
}

export function changedPaths(before: WorkspaceSnapshot, after: WorkspaceSnapshot): ChangedPath[] {
	if (before.head !== after.head) throw new WorkspaceError("Git HEAD changed during the Ralph run", "head_changed");
	if (before.branch !== after.branch) throw new WorkspaceError("Git branch changed during the Ralph run", "branch_changed");
	const prior = new Map(before.entries.map((entry) => [entry.path, entry]));
	const next = new Map(after.entries.map((entry) => [entry.path, entry]));
	const paths = [...new Set([...prior.keys(), ...next.keys()])].sort(byteSort);
	const changes: ChangedPath[] = [];
	for (const path of paths) {
		const left = prior.get(path);
		const right = next.get(path);
		if (!left && right) changes.push({ path, change: "added", after: right.digest });
		else if (left && !right) changes.push({ path, change: "deleted", before: left.digest });
		else if (left && right && (left.digest !== right.digest || left.mode !== right.mode || left.kind !== right.kind)) {
			changes.push({ path, change: "modified", before: left.digest, after: right.digest });
		}
	}
	return changes;
}

export function assertWorkspaceMatches(expected: WorkspaceSnapshot, actual: WorkspaceSnapshot): void {
	if (expected.hash !== actual.hash) {
		const changes = changedPaths(expected, actual);
		const summary = changes.slice(0, 20).map((change) => `${change.change}: ${change.path}`).join(", ");
		throw new WorkspaceError(`Workspace changed outside the active Ralph stage${summary ? ` (${summary})` : ""}`, "workspace_conflict");
	}
}

export function renderWorkspaceChanges(
	projectRootInput: string,
	baseline: WorkspaceSnapshot,
	current: WorkspaceSnapshot,
	maxBytes = 192 * 1024,
): { manifest: ChangedPath[]; text: string } {
	const projectRoot = realpathSync(projectRootInput);
	const manifest = changedPaths(baseline, current);
	const diff = git(projectRoot, ["diff", "HEAD", "--no-ext-diff", "--unified=40", "--", "."], maxBytes + 1024).toString("utf8");
	const tracked = new Set(git(projectRoot, ["ls-files", "-z"]).toString("utf8").split("\0").filter(Boolean));
	const currentEntries = new Map(current.entries.map((entry) => [entry.path, entry]));
	const untrackedParts: string[] = [];
	for (const change of manifest) {
		if (change.change !== "added" || tracked.has(change.path)) continue;
		const absolute = resolve(projectRoot, change.path);
		const entry = currentEntries.get(change.path);
		const stat = lstatSync(absolute);
		if (!entry || stat.isSymbolicLink() || entry.kind === "symlink") {
			if (!stat.isSymbolicLink() || entry?.kind !== "symlink") throw new WorkspaceError(`Untracked path changed while rendering: ${change.path}`, "workspace_conflict");
			untrackedParts.push(`### Untracked symlink: ${change.path}\n(target: ${readlinkSync(absolute)})`);
			continue;
		}
		if (!stat.isFile() || entry.kind !== "file") {
			untrackedParts.push(`### Untracked non-file: ${change.path}\n(type: ${entry.kind})`);
			continue;
		}
		const content = readFileSync(absolute);
		if (sha256(content) !== entry.digest) throw new WorkspaceError(`Untracked file changed while rendering: ${change.path}`, "workspace_conflict");
		if (content.includes(0)) {
			untrackedParts.push(`### Untracked binary: ${change.path}\n(${content.length} bytes)`);
		} else {
			untrackedParts.push(`### Untracked file: ${change.path}\n\`\`\`\n${content.toString("utf8")}\n\`\`\``);
		}
	}
	const text = [
		"## Changed paths",
		manifest.length ? manifest.map((change) => `- ${change.change}: ${change.path}`).join("\n") : "- None",
		"",
		"## Git diff",
		diff || "(no tracked diff)",
		untrackedParts.join("\n\n"),
	].filter(Boolean).join("\n");
	if (Buffer.byteLength(text) > maxBytes) {
		throw new WorkspaceError(`Review context exceeds ${maxBytes} bytes`, "review_context_budget");
	}
	return { manifest, text };
}

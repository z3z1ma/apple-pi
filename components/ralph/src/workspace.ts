import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

export class WorkspaceError extends Error {
	constructor(
		message: string,
		readonly code: string,
	) {
		super(message);
		this.name = "WorkspaceError";
	}
}

function git(projectRoot: string, args: string[], maxBuffer = 16 * 1024 * 1024): Buffer {
	try {
		return execFileSync("git", ["-C", projectRoot, ...args], {
			encoding: "buffer",
			maxBuffer,
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		const stderr = (error as { stderr?: Buffer }).stderr?.toString("utf8").trim();
		throw new WorkspaceError(stderr || `git ${args.join(" ")} failed`, "git_error");
	}
}

export function assertWorkspaceReady(projectRootInput: string): void {
	const projectRoot = realpathSync(projectRootInput);
	if (git(projectRoot, ["rev-parse", "--is-inside-work-tree"]).toString("utf8").trim() !== "true") {
		throw new WorkspaceError("Ralph requires a Git working tree", "not_git_repository");
	}
	git(projectRoot, ["rev-parse", "--verify", "HEAD"]);
	const unmerged = git(projectRoot, ["diff", "--name-only", "--diff-filter=U", "-z"]);
	if (unmerged.length > 0) throw new WorkspaceError("Workspace has unmerged paths", "unmerged_paths");
	for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"]) {
		const path = git(projectRoot, ["rev-parse", "--git-path", marker]).toString("utf8").trim();
		if (path && existsSync(resolve(projectRoot, path)))
			throw new WorkspaceError(`Git operation in progress: ${marker}`, "git_operation_in_progress");
	}
	for (const marker of ["rebase-apply", "rebase-merge"]) {
		const path = git(projectRoot, ["rev-parse", "--git-path", marker]).toString("utf8").trim();
		if (path && existsSync(resolve(projectRoot, path)))
			throw new WorkspaceError(`Git operation in progress: ${marker}`, "git_operation_in_progress");
	}
	const index = git(projectRoot, ["ls-files", "--stage", "-z"]).toString("utf8");
	if (/(?:^|\0)160000\s/.test(index))
		throw new WorkspaceError("Ralph does not execute in workspaces containing Git submodules", "unsupported_gitlink");
}

const DIFF_PREVIEW_BYTES = 96 * 1024;

export function renderWorkspaceChanges(projectRootInput: string): string {
	const projectRoot = realpathSync(projectRootInput);
	assertWorkspaceReady(projectRoot);
	const status = git(projectRoot, ["status", "--short", "--untracked-files=all"]).toString("utf8").trim();
	const stat = git(projectRoot, ["diff", "HEAD", "--stat", "--", "."]).toString("utf8").trim();
	let diff: string;
	try {
		diff = git(projectRoot, ["diff", "HEAD", "--no-ext-diff", "--unified=40", "--", "."], DIFF_PREVIEW_BYTES + 1024)
			.toString("utf8")
			.trim();
	} catch {
		diff = "(diff omitted because it exceeded the preview buffer)";
	}
	if (Buffer.byteLength(diff) > DIFF_PREVIEW_BYTES) {
		diff = `${diff.slice(0, DIFF_PREVIEW_BYTES)}\n\n(diff truncated)`;
	}
	return [
		"## Status",
		status || "(clean)",
		"",
		"## Diff stat",
		stat || "(no tracked diff)",
		"",
		"## Diff",
		diff || "(no tracked diff)",
	].join("\n");
}

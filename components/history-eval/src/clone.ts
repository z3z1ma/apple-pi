import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloneIgnoredDirs, git } from "../../shared/src/git.js";

/** A temporary clone of a repository, checked out at one commit. Remove it with `dispose`. */
export interface Clone {
	dir: string;
	dispose: () => void;
}

/**
 * A fresh repository holding only the history reachable from `commit`, checked out there on branch
 * `main`, with the listed ignored directories (dependencies) cloned from `repo` the way a search
 * clones them into its worktrees. A model working in it cannot read later commits, such as
 * the task's solution or its oracle tests, through git. A temporary ref in `repo` names the commit for
 * the fetch, which transfers only reachable objects, and is deleted at once. The clone has no remote,
 * so nothing that runs in it can push back to `repo`, and a local identity for commits.
 */
export async function cloneAt(repo: string, commit: string, cloneIgnored: string[]): Promise<Clone> {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "apple-pi-eval-clone-")));
	const dispose = () => rmSync(dir, { recursive: true, force: true });
	const ref = `refs/apple-pi-eval/${randomBytes(6).toString("hex")}`;
	try {
		await git(dir, ["init", "--quiet", "--initial-branch=main"]);
		await git(repo, ["update-ref", ref, commit]);
		try {
			await git(dir, [
				"fetch",
				"--quiet",
				"--no-tags",
				"--no-write-fetch-head",
				"--update-head-ok",
				repo,
				`${ref}:refs/heads/main`,
			]);
		} finally {
			await git(repo, ["update-ref", "-d", ref]);
		}
		// HEAD already names the (until now unborn) branch the fetch created; fill the index and working tree.
		await git(dir, ["reset", "--quiet", "--hard", "main"]);
		for (const [key, value] of [
			["user.name", "apple-pi-eval"],
			["user.email", "apple-pi-eval@localhost"],
			["commit.gpgsign", "false"],
		] as const)
			await git(dir, ["config", key, value]);
		await cloneIgnoredDirs(repo, dir, cloneIgnored);
		return { dir, dispose };
	} catch (error) {
		dispose();
		throw error;
	}
}

/** A file's exact bytes at a commit, as text; `git` trims its output, which test files must not lose. */
export function showFile(repo: string, commit: string, path: string): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			"git",
			["show", `${commit}:${path}`],
			{ cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error) reject(new Error(`git show ${commit}:${path} failed: ${stderr.trim() || error.message}`));
				else resolve(stdout);
			},
		);
	});
}

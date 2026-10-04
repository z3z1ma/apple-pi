import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { canonical } from "../../shared/src/real-path.js";

/**
 * Git plumbing for one search: the base snapshot, worktrees, branch commits, refs, and
 * cleanup (spec 6.1, 6.6 step 7, 6.11, 8.1, 8.2). Nothing here writes the user's index.
 */

const COMMITTER = ["-c", "user.name=apple-pi", "-c", "user.email=apple-pi@localhost", "-c", "commit.gpgsign=false"];

export interface GitOptions {
	env?: NodeJS.ProcessEnv;
}

export function git(cwd: string, args: string[], options: GitOptions = {}): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		execFile(
			"git",
			args,
			{
				cwd,
				// No optional locks: status-like reads never refresh the user's index.
				env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", ...options.env },
				maxBuffer: 256 * 1024 * 1024,
			},
			(error, stdout, stderr) => {
				if (error) reject(new Error(`git ${args.join(" ")} failed: ${stderr.trim() || error.message}`));
				else resolvePromise(stdout.trim());
			},
		);
	});
}

export function refPrefix(id: string): string {
	return `refs/apple-pi/branch-search/${id}/`;
}

export function baseRef(id: string): string {
	return `${refPrefix(id)}base`;
}

export function branchRef(id: string, key: string): string {
	return `${refPrefix(id)}${key}`;
}

export async function hasHead(cwd: string): Promise<boolean> {
	try {
		await git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
		return true;
	} catch {
		return false;
	}
}

/** The repository root in the session's spelling of the path, which is the one the model sees. */
export async function repoRoot(cwd: string): Promise<string> {
	return resolve(cwd, await git(cwd, ["rev-parse", "--show-cdup"]));
}

export async function gitCommonDir(cwd: string): Promise<string> {
	return resolve(cwd, await git(cwd, ["rev-parse", "--git-common-dir"]));
}

/** The tree of the workspace as it stands, built in a temporary index (spec 6.1 step 5). */
export async function snapshotTree(root: string): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), "apple-pi-branch-index-"));
	const env = { GIT_INDEX_FILE: join(dir, "index") };
	try {
		await git(root, ["read-tree", "HEAD"], { env });
		await git(root, ["add", "-A"], { env });
		return await git(root, ["write-tree"], { env });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Commit the workspace, uncommitted and untracked non-ignored files included, as the search base. */
export async function snapshotBase(root: string, id: string): Promise<{ commit: string; tree: string }> {
	const tree = await snapshotTree(root);
	const commit = await git(root, [...COMMITTER, "commit-tree", tree, "-p", "HEAD", "-m", `branch-search ${id} base`]);
	await git(root, ["update-ref", baseRef(id), commit]);
	return { commit, tree };
}

function cloneCommand(source: string, target: string): [string, string[]] {
	// Copy-on-write clones where the filesystem supports them (APFS, btrfs, XFS). On macOS the
	// system cp owns -c; a GNU cp earlier on PATH does not.
	return process.platform === "darwin"
		? ["/bin/cp", ["-cR", source, target]]
		: ["cp", ["-R", "--reflink=auto", source, target]];
}

function run(command: string, args: string[]): Promise<void> {
	return new Promise((resolvePromise, reject) => {
		execFile(command, args, (error, _stdout, stderr) => {
			if (error) reject(new Error(`${command} ${args.join(" ")} failed: ${stderr.trim() || error.message}`));
			else resolvePromise();
		});
	});
}

/** A detached worktree at `commit`, with the listed ignored directories cloned from the parent (spec 8.1, 8.2). */
export async function addWorktree(root: string, path: string, commit: string, cloneIgnored: string[]): Promise<void> {
	mkdirSync(dirname(path), { recursive: true });
	await git(root, ["worktree", "add", "--detach", "-q", path, commit]);
	for (const entry of cloneIgnored) {
		const source = join(root, entry);
		const target = join(path, entry);
		if (!existsSync(source) || existsSync(target)) continue;
		mkdirSync(dirname(target), { recursive: true });
		const [command, args] = cloneCommand(source, target);
		await run(command, args);
	}
}

/** Commit everything in the worktree and point the branch ref at it (spec 6.6 step 7). */
export async function commitWorktree(root: string, path: string, id: string, key: string): Promise<string> {
	await git(path, ["add", "-A"]);
	await git(path, [...COMMITTER, "commit", "--no-verify", "--allow-empty", "-q", "-m", `branch-search ${id} ${key}`]);
	const commit = await git(path, ["rev-parse", "HEAD"]);
	await git(root, ["update-ref", branchRef(id, key), commit]);
	return commit;
}

/**
 * Remove each worktree, locked or dirty, then prune git's records of them. Every path is attempted;
 * a worktree whose directory or git record remains is reported in the thrown error.
 */
export async function removeWorktrees(root: string, worktrees: Iterable<string>): Promise<void> {
	const paths = [...worktrees];
	const failures: string[] = [];
	for (const path of paths) {
		// A second --force removes a locked worktree too.
		const removed = await git(root, ["worktree", "remove", "--force", "--force", path]).then(
			() => undefined,
			(error: Error) => error.message,
		);
		try {
			rmSync(path, { recursive: true, force: true });
		} catch (error) {
			failures.push(`${path}: ${removed ?? (error instanceof Error ? error.message : String(error))}`);
		}
	}
	await git(root, ["worktree", "prune"]);
	const listed = new Set(
		(await git(root, ["worktree", "list", "--porcelain"]))
			.split("\n")
			.flatMap((line) => (line.startsWith("worktree ") ? [canonical(line.slice("worktree ".length))] : [])),
	);
	for (const path of paths) {
		if (listed.has(canonical(path)) && !failures.some((failure) => failure.startsWith(path)))
			failures.push(`${path}: still registered as a worktree`);
	}
	if (failures.length > 0) throw new Error(`Could not remove worktrees: ${failures.join("; ")}`);
}

/** Delete every ref of the search except the named keys. */
export async function pruneRefs(root: string, id: string, keep: string[]): Promise<void> {
	const refs = await git(root, ["for-each-ref", "--format=%(refname)", refPrefix(id)]);
	const kept = new Set(keep.map((key) => branchRef(id, key)));
	for (const ref of refs.split("\n").filter(Boolean)) {
		if (!kept.has(ref)) await git(root, ["update-ref", "-d", ref]);
	}
}

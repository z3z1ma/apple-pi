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
	/** Written to git's stdin. */
	input?: string;
}

export function git(cwd: string, args: string[], options: GitOptions = {}): Promise<string> {
	return new Promise((resolvePromise, reject) => {
		const child = execFile(
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
		if (options.input !== undefined) child.stdin?.end(options.input);
	});
}

/**
 * Flags for every `git diff` whose output the search parses or applies: a configured external diff
 * or textconv driver would otherwise replace the real content changes.
 */
export const PLAIN_DIFF = ["--no-ext-diff", "--no-textconv"];

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

export interface ApplyResult {
	applied: boolean;
	/** The workspace tree when apply was decided, compared with the base tree. */
	workspaceTree: string;
	/** Why the winner was not applied. */
	reason?: string;
}

/**
 * Apply the winner to the workspace only when apply mode is `auto` and the workspace still holds the
 * base tree (spec 6.9). The binary diff from base to winner goes to `patchPath`, which outlives
 * cleanup, and `git apply` lands it in the working tree without touching the user's index. `git apply`
 * checks the patch before writing but does not undo a write that fails partway, so a failure
 * restores every path the patch touches to base (see `restoreBase`).
 */
export async function applyWinner(
	root: string,
	options: {
		base: { commit: string; tree: string };
		winner: string;
		mode: "auto" | "report";
		patchPath: string;
		/** Checked last before the patch lands, so a cancelled search leaves the workspace as it was. */
		signal?: AbortSignal;
	},
): Promise<ApplyResult> {
	const workspaceTree = await snapshotTree(root);
	if (options.mode !== "auto") return { applied: false, workspaceTree, reason: "apply mode is report" };
	if (workspaceTree !== options.base.tree)
		return { applied: false, workspaceTree, reason: "the workspace changed during the search" };
	const { base, winner, patchPath } = options;
	await git(root, ["diff", ...PLAIN_DIFF, "--binary", `--output=${patchPath}`, base.commit, winner]);
	// A winner with the base tree changes nothing, and git apply refuses an empty patch.
	if ((await git(root, ["rev-parse", `${winner}^{tree}`])) === base.tree) return { applied: true, workspaceTree };
	options.signal?.throwIfAborted();
	try {
		await git(root, ["apply", "--whitespace=nowarn", patchPath]);
	} catch (error) {
		const failure = error instanceof Error ? error.message : String(error);
		const restored = await restoreBase(root, base.commit, winner).then(
			() => "the workspace was restored to the base",
			(rollback: Error) =>
				`restoring the base also failed, so the workspace may hold part of the winner: ${rollback.message}`,
		);
		return { applied: false, workspaceTree, reason: `${failure}; ${restored}` };
	}
	return { applied: true, workspaceTree };
}

/**
 * Put every path that differs between base and winner back to its base content, and remove the
 * paths only the winner has. Valid only while the workspace held the base tree before the patch.
 * A temporary index holding just the base entries of those paths finds which files differ and
 * checks them out; the user's index is never read or written.
 */
async function restoreBase(root: string, base: string, winner: string): Promise<void> {
	const split = (output: string) => output.split("\0").filter(Boolean);
	const touched = new Set(
		split(await git(root, ["diff", ...PLAIN_DIFF, "--no-renames", "--name-only", "-z", base, winner])),
	);
	const entries = split(await git(root, ["ls-tree", "-r", "-z", base])).filter((entry) =>
		touched.has(entry.slice(entry.indexOf("\t") + 1)),
	);
	const dir = mkdtempSync(join(tmpdir(), "apple-pi-branch-restore-"));
	const env = { GIT_INDEX_FILE: join(dir, "index") };
	try {
		await git(root, ["update-index", "-z", "--index-info"], { env, input: entries.map((e) => `${e}\0`).join("") });
		// Exits non-zero when entries need an update; diff-files then names them.
		await git(root, ["update-index", "-q", "--refresh"], { env }).catch(() => undefined);
		const changed = split(await git(root, ["diff-files", "--name-only", "-z"], { env }));
		if (changed.length > 0)
			await git(root, ["checkout-index", "-f", "-z", "--stdin"], { env, input: changed.map((p) => `${p}\0`).join("") });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	const inBase = new Set(entries.map((entry) => entry.slice(entry.indexOf("\t") + 1)));
	for (const path of touched) if (!inBase.has(path)) rmSync(join(root, path), { force: true });
}

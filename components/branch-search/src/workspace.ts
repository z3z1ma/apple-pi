import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { cloneIgnoredDirs, git } from "../../shared/src/git.js";
import { canonical } from "../../shared/src/real-path.js";

/**
 * Git plumbing for one search: the base snapshot, worktrees, attempt commits, refs, apply, and
 * cleanup. Nothing here writes the user's index.
 */

const COMMITTER = ["-c", "user.name=apple-pi", "-c", "user.email=apple-pi@localhost", "-c", "commit.gpgsign=false"];

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

export async function gitCommonDir(cwd: string): Promise<string> {
	return resolve(cwd, await git(cwd, ["rev-parse", "--git-common-dir"]));
}

/** The tree of the workspace as it stands, built in a temporary index. */
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

/** A detached worktree at `commit`, with the listed ignored directories cloned from the parent. */
export async function addWorktree(root: string, path: string, commit: string, cloneIgnored: string[]): Promise<void> {
	mkdirSync(dirname(path), { recursive: true });
	await git(root, ["worktree", "add", "--detach", "-q", path, commit]);
	await cloneIgnoredDirs(root, path, cloneIgnored);
}

/** Commit everything in the worktree and point the attempt's ref at it. */
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
 * Apply the winner to the workspace only when the workspace still holds the base tree. The binary diff from base to winner goes to `patchPath`, which outlives
 * cleanup, and `git apply` lands it in the working tree without touching the user's index. `git apply`
 * checks the patch before writing but does not undo a write that fails partway, so a failure
 * restores to base every path the patch wrote that still holds what it wrote (see `restoreOwned`).
 */
export async function applyWinner(
	root: string,
	options: {
		base: { commit: string; tree: string };
		winner: string;
		patchPath: string;
		/** Checked last before the patch lands, so a cancelled search leaves the workspace as it was. */
		signal?: AbortSignal;
	},
): Promise<ApplyResult> {
	const workspaceTree = await snapshotTree(root);
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
		const restored = await restoreOwned(root, base.commit, winner).then(
			(left) =>
				left.length === 0
					? "the workspace was restored to the base"
					: `the workspace was restored to the base, except paths changed meanwhile by someone else: ${left.join(", ")}`,
			(rollback: Error) =>
				`restoring the base also failed, so the workspace may hold part of the winner: ${rollback.message}`,
		);
		return { applied: false, workspaceTree, reason: `${failure}; ${restored}` };
	}
	return { applied: true, workspaceTree };
}

/** What a path holds in the working tree: its blob id, or undefined when it is absent. */
async function workingBlob(root: string, path: string): Promise<string | undefined> {
	const target = join(root, path);
	let stat: ReturnType<typeof lstatSync>;
	try {
		stat = lstatSync(target);
	} catch (error) {
		// Only absence counts as absent; a path that cannot be inspected is not shown to be owned.
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") return undefined;
		throw error;
	}
	if (stat.isSymbolicLink()) return git(root, ["hash-object", "--stdin"], { input: readlinkSync(target) });
	if (!stat.isFile()) return undefined;
	return git(root, ["hash-object", "--", path]);
}

/**
 * Roll back a failed apply: put back to base only the paths the apply still owns, those that hold
 * exactly what the winner has (its content, or absence for a path the winner deletes). A path that
 * holds anything else was changed by someone else meanwhile and is left alone; so is a path that
 * already holds its base content. Returns the paths left alone because someone else changed them.
 * A temporary index holding the base entries of the owned paths checks them out; the user's index
 * is never read or written.
 */
export async function restoreOwned(root: string, base: string, winner: string): Promise<string[]> {
	const split = (output: string) => output.split("\0").filter(Boolean);
	const touched = split(await git(root, ["diff", ...PLAIN_DIFF, "--no-renames", "--name-only", "-z", base, winner]));
	const blobs = async (commit: string) => {
		const entries = new Map<string, { entry: string; oid: string }>();
		for (const entry of split(await git(root, ["ls-tree", "-r", "-z", commit]))) {
			const tab = entry.indexOf("\t");
			entries.set(entry.slice(tab + 1), { entry, oid: entry.slice(0, tab).split(" ")[2] as string });
		}
		return entries;
	};
	const [inBase, inWinner] = [await blobs(base), await blobs(winner)];
	const restore: string[] = [];
	const remove: string[] = [];
	const left: string[] = [];
	for (const path of touched) {
		const current = await workingBlob(root, path);
		if (current === inBase.get(path)?.oid) continue;
		if (current !== inWinner.get(path)?.oid) left.push(path);
		else if (inBase.has(path)) restore.push(path);
		else remove.push(path);
	}
	if (restore.length > 0) {
		const dir = mkdtempSync(join(tmpdir(), "apple-pi-branch-restore-"));
		const env = { GIT_INDEX_FILE: join(dir, "index") };
		try {
			const entries = restore.map((path) => `${inBase.get(path)?.entry}\0`).join("");
			await git(root, ["update-index", "-z", "--index-info"], { env, input: entries });
			await git(root, ["checkout-index", "-f", "-z", "--stdin"], { env, input: restore.map((p) => `${p}\0`).join("") });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
	for (const path of remove) rmSync(join(root, path), { force: true });
	return left;
}

export interface DiffStat {
	added: number;
	deleted: number;
	files: number;
}

/** `git diff --numstat` totals; binary rows count as 0 lines. */
export async function diffStat(root: string, from: string, to: string): Promise<DiffStat> {
	const rows = (await git(root, ["diff", ...PLAIN_DIFF, "--numstat", from, to])).split("\n").filter(Boolean);
	const count = (value: string | undefined) => (value === undefined || value === "-" ? 0 : Number(value));
	let added = 0;
	let deleted = 0;
	for (const row of rows) {
		const [plus, minus] = row.split("\t");
		added += count(plus);
		deleted += count(minus);
	}
	return { added, deleted, files: rows.length };
}

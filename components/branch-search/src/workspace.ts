import { execFile } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync } from "node:fs";
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

/**
 * A git environment whose new objects go to the private store `objects`, while the repository's own
 * store stays readable. Objects written under it never enter the repository's object store, so
 * deleting `objects` removes them from disk entirely; no ref may point at them.
 */
export function privateObjects(commonDir: string, objects: string): Record<string, string> {
	mkdirSync(objects, { recursive: true });
	return { GIT_OBJECT_DIRECTORY: objects, GIT_ALTERNATE_OBJECT_DIRECTORIES: join(commonDir, "objects") };
}

/** A detached worktree at `commit`, with the listed ignored directories cloned from the parent (spec 8.1, 8.2). */
export async function addWorktree(
	root: string,
	path: string,
	commit: string,
	cloneIgnored: string[],
	env?: NodeJS.ProcessEnv,
): Promise<void> {
	mkdirSync(dirname(path), { recursive: true });
	await git(root, ["worktree", "add", "--detach", "-q", path, commit], { env });
	await cloneIgnoredDirs(root, path, cloneIgnored);
}

/** Clone each listed ignored directory of `root` that exists into `path`, unless `path` already has it (spec 8.2). */
export async function cloneIgnoredDirs(root: string, path: string, cloneIgnored: string[]): Promise<void> {
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
	const commit = await commitAll(path, `branch-search ${id} ${key}`);
	await git(root, ["update-ref", branchRef(id, key), commit]);
	return commit;
}

/** Commit everything in the worktree to its HEAD, without a ref; under `privateObjects`, into that store. */
export async function commitAll(path: string, message: string, env?: NodeJS.ProcessEnv): Promise<string> {
	await git(path, ["add", "-A"], { env });
	// An automatic gc would run on the private store alone.
	const gc = env ? ["-c", "gc.auto=0"] : [];
	await git(path, [...COMMITTER, ...gc, "commit", "--no-verify", "--allow-empty", "-q", "-m", message], { env });
	return git(path, ["rev-parse", "HEAD"], { env });
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

/** Every ref of the repository with the object it names, `refs/stash` included. */
export async function readRefs(root: string, env?: NodeJS.ProcessEnv): Promise<Map<string, string>> {
	const lines = await git(root, ["for-each-ref", "--format=%(refname) %(objectname)"], { env });
	return new Map(
		lines
			.split("\n")
			.filter(Boolean)
			.map((line) => line.split(" ") as [string, string]),
	);
}

/**
 * Restore the refs to `before`, except those under `skip`: delete a ref that was created (and its
 * reflog), recreate one that was deleted, and for one that moved, drop its newest reflog entries
 * while they do not lead back to the old value, then set it. `env` keeps objects named by the
 * entries being dropped readable.
 */
export async function restoreRefs(
	root: string,
	before: Map<string, string>,
	skip: string,
	env?: NodeJS.ProcessEnv,
): Promise<void> {
	const after = await readRefs(root, env);
	for (const [ref, value] of after) {
		if (ref.startsWith(skip) || before.get(ref) === value) continue;
		const old = before.get(ref);
		if (old === undefined) {
			await git(root, ["update-ref", "-d", ref], { env });
			continue;
		}
		const entries = (await git(root, ["reflog", "show", "--format=%H", ref], { env }).catch(() => ""))
			.split("\n")
			.filter(Boolean);
		for (const entry of entries) {
			if (entry === old) break;
			await git(root, ["reflog", "delete", "--updateref", "--rewrite", `${ref}@{0}`], { env });
		}
		if ((await readRefs(root, env)).get(ref) !== old) await git(root, ["update-ref", ref, old], { env });
	}
	for (const [ref, value] of before)
		if (!ref.startsWith(skip) && !after.has(ref)) await git(root, ["update-ref", ref, value], { env });
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
 * restores to base every path the patch wrote that still holds what it wrote (see `restoreOwned`).
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

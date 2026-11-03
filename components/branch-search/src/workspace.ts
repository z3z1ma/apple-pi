import { execFile } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { cloneIgnoredDirs, git } from "../../shared/src/git.js";
import { canonical, within } from "../../shared/src/real-path.js";
import { relativePathsProblem } from "../../shared/src/relative-paths.js";

const COMMITTER = ["-c", "user.name=apple-pi", "-c", "user.email=apple-pi@localhost", "-c", "commit.gpgsign=false"];

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

export async function snapshotBase(root: string, id: string): Promise<{ commit: string; tree: string }> {
	const tree = await snapshotTree(root);
	const commit = await git(root, [...COMMITTER, "commit-tree", tree, "-p", "HEAD", "-m", `branch-search ${id} base`]);
	await git(root, ["update-ref", baseRef(id), commit]);
	return { commit, tree };
}

export async function addWorktree(root: string, path: string, commit: string, cloneIgnored: string[]): Promise<void> {
	mkdirSync(dirname(path), { recursive: true });
	await git(root, ["worktree", "add", "--detach", "-q", path, commit]);
	await cloneIgnoredDirs(root, path, cloneIgnored);
}

export function protectProblem(root: string, paths: readonly string[]): string | undefined {
	const lexical = relativePathsProblem(paths);
	if (lexical !== undefined) return lexical;
	const top = canonical(root);
	const outside = paths.find((path) => {
		try {
			return !within(canonical(join(root, path)), top);
		} catch {
			return true;
		}
	});
	if (outside !== undefined) return `must hold paths inside the workspace ("${outside}" resolves outside it)`;
	for (const path of paths) {
		const parts = path.split("/");
		const linked = parts.some((_, i) => isSymlink(join(root, ...parts.slice(0, i + 1))));
		if (linked)
			return `"${path}" is or goes through a symlink; protect "${relative(top, canonical(join(root, path)))}" instead`;
	}
	return undefined;
}

function isSymlink(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}

export async function restoreProtected(
	snapshot: string,
	path: string,
	base: string,
	protect: readonly string[],
	cloneIgnored: readonly string[],
): Promise<string[]> {
	if (protect.length === 0) return [];
	const overlapping = protectedClones(protect, cloneIgnored);
	const top = canonical(path);
	for (const entry of overlapping)
		if (!within(canonical(dirname(join(path, entry))), top))
			throw new Error(`${entry} resolves outside the attempt's worktree`);
	const recloned: string[] = [];
	for (const entry of overlapping) {
		if (await differs(join(snapshot, entry), join(path, entry))) recloned.push(`${entry}/`);
		rmSync(join(path, entry), { recursive: true, force: true });
	}
	await cloneIgnoredDirs(snapshot, path, overlapping);
	const literal = ["--literal-pathspecs"];
	const changed = (
		await git(path, [
			...literal,
			"diff",
			...PLAIN_DIFF,
			"--no-renames",
			"--name-only",
			"-z",
			base,
			"HEAD",
			"--",
			...protect,
		])
	)
		.split("\0")
		.filter(Boolean);
	if (changed.length > 0)
		await git(path, [...literal, "restore", `--source=${base}`, "--staged", "--worktree", "--", ...changed]);
	const keep = cloneIgnored.flatMap((entry) => ["-e", `/${entry}`]);
	const cleaned = (await git(path, [...literal, "clean", "-ffdx", ...keep, "--", ...protect]))
		.split("\n")
		.flatMap((line) => (line.startsWith("Removing ") ? [line.slice("Removing ".length)] : []));
	return [...changed, ...cleaned, ...recloned].sort();
}

export async function protectedState(path: string, protect: readonly string[]): Promise<string> {
	const head = await git(path, ["rev-parse", "HEAD"]);
	const status = await git(path, [
		"--literal-pathspecs",
		"status",
		"--porcelain=v1",
		"-z",
		"--untracked-files=all",
		"--",
		...protect,
	]);
	return `${head}\n${status}`;
}

export function protectedClones(protect: readonly string[], cloneIgnored: readonly string[]): string[] {
	const inside = (a: string, b: string) => within(join("/", a), join("/", b));
	return cloneIgnored.filter((entry) => protect.some((p) => inside(entry, p) || inside(p, entry)));
}

function differs(a: string, b: string): Promise<boolean> {
	if (!existsSync(a) && !existsSync(b)) return Promise.resolve(false);
	return new Promise((resolvePromise) => {
		execFile("diff", ["-rq", a, b], { maxBuffer: 64 * 1024 * 1024 }, (error) => resolvePromise(error !== null));
	});
}

export async function commitWorktree(root: string, path: string, id: string, key: string): Promise<string> {
	await git(path, ["add", "-A"]);
	await git(path, [...COMMITTER, "commit", "--no-verify", "--allow-empty", "-q", "-m", `branch-search ${id} ${key}`]);
	const commit = await git(path, ["rev-parse", "HEAD"]);
	await git(root, ["update-ref", branchRef(id, key), commit]);
	return commit;
}

export async function removeWorktrees(root: string, worktrees: Iterable<string>): Promise<void> {
	const paths = [...worktrees];
	const failures: string[] = [];
	for (const path of paths) {
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

export async function pruneRefs(root: string, id: string, keep: string[]): Promise<void> {
	const refs = await git(root, ["for-each-ref", "--format=%(refname)", refPrefix(id)]);
	const kept = new Set(keep.map((key) => branchRef(id, key)));
	for (const ref of refs.split("\n").filter(Boolean)) {
		if (!kept.has(ref)) await git(root, ["update-ref", "-d", ref]);
	}
}

export interface ApplyResult {
	applied: boolean;
	workspaceTree: string;
	reason?: string;
}

export async function applyWinner(
	root: string,
	options: {
		base: { commit: string; tree: string };
		winner: string;
		patchPath: string;
		signal?: AbortSignal;
	},
): Promise<ApplyResult> {
	const workspaceTree = await snapshotTree(root);
	if (workspaceTree !== options.base.tree)
		return { applied: false, workspaceTree, reason: "the workspace changed during the search" };
	const { base, winner, patchPath } = options;
	await git(root, ["diff", ...PLAIN_DIFF, "--binary", `--output=${patchPath}`, base.commit, winner]);
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

async function workingBlob(root: string, path: string): Promise<string | undefined> {
	const target = join(root, path);
	let stat: ReturnType<typeof lstatSync>;
	try {
		stat = lstatSync(target);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") return undefined;
		throw error;
	}
	if (stat.isSymbolicLink()) return git(root, ["hash-object", "--stdin"], { input: readlinkSync(target) });
	if (!stat.isFile()) return undefined;
	return git(root, ["hash-object", "--", path]);
}

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

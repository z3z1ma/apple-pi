import { spawn } from "node:child_process";
import { copyFile, mkdtemp, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Static, Type } from "typebox";
import { type GitOptions, gitBytes } from "./git.js";

export const GIT_TARGET_HELP =
	'The change: {"kind":"working-tree","base":"HEAD"} for tracked, staged and untracked edits against an exact base; {"kind":"staged"} for the index against HEAD; {"kind":"commit","commit":"X"} for one commit against its parent (merges need "parent"); {"kind":"range","base":"A","head":"B"} for exact endpoints; {"kind":"branch","base":"main","head":"feature"} for feature since its merge base with main, as a pull request shows it.';
const ref = Type.String({ minLength: 1, pattern: "\\S" });
const strict = { additionalProperties: false } as const;
export const GitTargetSchema = Type.Union(
	[
		Type.Object({ kind: Type.Literal("working-tree"), base: ref }, strict),
		Type.Object({ kind: Type.Literal("staged") }, strict),
		Type.Object({ kind: Type.Literal("commit"), commit: ref, parent: Type.Optional(ref) }, strict),
		Type.Object({ kind: Type.Literal("range"), base: ref, head: ref }, strict),
		Type.Object({ kind: Type.Literal("branch"), base: ref, head: ref }, strict),
	],
	{ description: GIT_TARGET_HELP },
);
export type GitTarget = Static<typeof GitTargetSchema>;
export const WORKING_TREE: GitTarget = { kind: "working-tree", base: "HEAD" };

/** Isolate commands from ambient repository redirection, user configuration, hooks and fsmonitor daemons. */
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
const FLAGS = [
	"--no-pager",
	"-c",
	"core.fsmonitor=false",
	"-c",
	"core.hooksPath=/dev/null",
	"-c",
	"core.quotePath=false",
	"-c",
	"core.splitIndex=false",
];
export const GIT_DIFF = ["diff", "--no-ext-diff", "--no-textconv", "--no-color"];
const EMPTY_TREE: Record<string, string> = {
	sha1: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
	sha256: "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321",
};

/** Exact bytes on disk: no worktree attributes (filters, eol), autocrlf or filesystem capability guesses. */
export const rawFlags = (objectFormat: string) => [
	`--attr-source=${EMPTY_TREE[objectFormat]}`,
	"-c",
	"core.autocrlf=false",
	"-c",
	"core.filemode=true",
	"-c",
	"core.symlinks=true",
];

export function gitRun(cwd: string, args: string[], options: GitOptions = {}): Promise<Buffer> {
	return gitBytes(cwd, [...FLAGS, ...args], { ...options, env: { ...ENV, ...options.env } });
}
export async function gitLine(cwd: string, args: string[], options?: GitOptions): Promise<string> {
	return (await gitRun(cwd, args, options)).toString("utf8").replace(/\n$/, "");
}

/** Length-delimited `cat-file --batch -Z`: blob bytes may contain newlines, NULs and invalid UTF-8. */
export function objectReader(cwd: string, env: NodeJS.ProcessEnv = {}, signal?: AbortSignal) {
	const child = spawn("git", [...FLAGS, "cat-file", "--batch", "-Z"], {
		cwd,
		env: { ...process.env, ...ENV, ...env },
		signal,
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stderr = "";
	let failure: Error | undefined;
	child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
		stderr += chunk;
	});
	child.stdin.on("error", () => {});
	const fail = (error: Error) => {
		failure ??= error;
		for (const waiter of waiting.splice(0)) waiter();
	};
	child.once("error", fail);
	child.once("close", (code) => fail(new Error(`git cat-file ended: ${stderr.trim() || `exit ${code}`}`)));
	let buffer: Buffer = Buffer.alloc(0);
	const waiting: (() => void)[] = [];
	child.stdout.on("data", (chunk: Buffer) => {
		buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
		for (const waiter of waiting.splice(0)) waiter();
	});
	const available = async (size: number) => {
		while (buffer.length < size) {
			if (failure) throw failure;
			await new Promise<void>((resolve) => waiting.push(resolve));
		}
	};
	const take = (size: number) => {
		const data = buffer.subarray(0, size);
		buffer = buffer.subarray(size);
		return data;
	};
	let queue: Promise<unknown> = Promise.resolve();
	const request = async (spec: string): Promise<Buffer | undefined> => {
		if (spec.includes("\0")) throw new Error("Git object names cannot contain NUL");
		child.stdin.write(`${spec}\0`);
		let end = buffer.indexOf(0);
		while (end < 0) {
			await available(buffer.length + 1);
			end = buffer.indexOf(0);
		}
		const header = take(end + 1)
			.subarray(0, end)
			.toString("utf8");
		const [, type, length, ...rest] = header.split(" ");
		// "<name> missing", "<oid> submodule" and similar replies carry no object body.
		if (length === undefined || rest.length || !/^\d+$/.test(length)) return undefined;
		const size = Number(length);
		await available(size + 1);
		const data = Buffer.from(take(size));
		if (take(1)[0] !== 0) throw new Error("Invalid Git object terminator");
		return type === "blob" ? data : undefined;
	};
	return {
		/** One object at a time, in request order; `<tree>:<path>` reads a path inside an immutable tree. */
		read(spec: string): Promise<Buffer | undefined> {
			const next = queue.then(() => request(spec));
			queue = next.catch(() => {});
			return next;
		},
		close() {
			child.stdin.end();
			if (child.exitCode === null) child.kill();
		},
	};
}

export interface GitChange {
	repository: string;
	commonDirectory: string;
	objectFormat: string;
	target: GitTarget;
	baseCommit: string | null;
	headCommit: string;
	baseTree: string;
	headTree: string;
	/** The index tree when the target is staged or working-tree; null for committed targets. */
	indexTree: string | null;
	/** Environment that sees the private objects written for this change alongside the repository's. */
	env: NodeJS.ProcessEnv;
	git(args: string[], options?: GitOptions): Promise<Buffer>;
	/** Exact bytes at one side of the change, or undefined when the path is absent there. */
	read(side: "before" | "after", path: string): Promise<Buffer | undefined>;
	close(): Promise<void>;
}

/** One `rev-parse` locates the repository and pins every named endpoint; options cannot hide in revisions. */
async function locate(cwd: string, target: GitTarget, signal?: AbortSignal) {
	const head =
		target.kind === "commit"
			? target.commit
			: target.kind === "range" || target.kind === "branch"
				? target.head
				: "HEAD";
	const names = [
		head,
		...(target.kind === "commit"
			? target.parent
				? [target.parent]
				: []
			: target.kind === "staged"
				? []
				: [target.base]),
	];
	const [repository, commonDirectory, objectFormat, index, ...ids] = (
		await gitLine(
			cwd,
			[
				"rev-parse",
				"--path-format=absolute",
				"--show-toplevel",
				"--git-common-dir",
				"--show-object-format",
				"--git-path",
				"index",
				"--end-of-options",
				...names.flatMap((name) => [`${name}^{commit}`, `${name}^{tree}`]),
			],
			{ signal },
		)
	)
		.split("\n")
		.filter((line) => line !== "--end-of-options");
	const commits = names.map((_, i) => ({ commit: ids[2 * i]!, tree: ids[2 * i + 1]! }));
	return {
		repository: repository!,
		commonDirectory: commonDirectory!,
		objectFormat: objectFormat!,
		index: index!,
		head: commits[0]!,
		base: commits[1],
	};
}

async function resolveBase(
	root: string,
	target: GitTarget,
	located: Awaited<ReturnType<typeof locate>>,
	signal?: AbortSignal,
) {
	const { head, base, objectFormat } = located;
	if (target.kind === "commit") {
		const parents = (await gitLine(root, ["rev-list", "--parents", "-n", "1", head.commit], { signal }))
			.split(" ")
			.slice(1);
		if (parents.length > 1 && !target.parent) throw new Error("A merge commit needs an explicit parent comparison");
		if (base && !parents.includes(base.commit))
			throw new Error("The selected comparison is not a parent of this commit; use a range for another base");
		if (base) return { baseCommit: base.commit, baseTree: base.tree };
		return parents[0]
			? { baseCommit: parents[0], baseTree: await gitLine(root, ["rev-parse", `${parents[0]}^{tree}`], { signal }) }
			: { baseCommit: null, baseTree: EMPTY_TREE[objectFormat]! };
	}
	if (target.kind === "staged") return { baseCommit: head.commit, baseTree: head.tree };
	if (target.kind !== "branch") return { baseCommit: base!.commit, baseTree: base!.tree };
	const bases = (await gitLine(root, ["merge-base", "--all", base!.commit, head.commit], { signal }))
		.split("\n")
		.filter(Boolean);
	if (bases.length !== 1)
		throw new Error("A branch comparison requires one unambiguous merge base; choose an exact range");
	return { baseCommit: bases[0]!, baseTree: await gitLine(root, ["rev-parse", `${bases[0]}^{tree}`], { signal }) };
}

/**
 * Copy an index with its modification time: racy-git detection compares entries with the index file's own
 * timestamp, so a fresh timestamp would hide same-second edits that the original index still re-checks.
 */
export async function copyIndex(source: string, target: string): Promise<void> {
	try {
		await copyFile(source, target);
		const { atime, mtime } = await stat(source);
		await utimes(target, atime, mtime);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

/**
 * Snapshot staged and working-tree state the way `git stash create` does: a copy of the index absorbs changes
 * with `git add -A`, so Git's stat cache hashes only changed files. Worktree attributes and autocrlf are disabled
 * so blobs keep the exact bytes on disk. New objects go to `objects`; the author's index and objects stay unchanged.
 */
async function snapshot(
	root: string,
	source: string,
	objectFormat: string,
	env: NodeJS.ProcessEnv,
	working: boolean,
	signal?: AbortSignal,
) {
	const scratch = await mkdtemp(join(tmpdir(), "git-index-"));
	try {
		const index = join(scratch, "index");
		await copyIndex(source, index);
		const options = { signal, env: { ...env, GIT_INDEX_FILE: index } };
		// Writing an index re-hashes racily clean entries, which would run clean filters without raw flags.
		const raw = rawFlags(objectFormat);
		const tree = () =>
			gitLine(root, [...raw, "write-tree"], options).catch((error: Error) => {
				throw /unmerged|conflict/i.test(error.message)
					? new Error("Resolve index conflicts before selecting staged or working-tree changes")
					: error;
			});
		const indexTree = await tree();
		if (!working) return { indexTree, headTree: indexTree };
		// bigFileThreshold=1 streams every new blob into one pack (bulk check-in) instead of one loose file each.
		await gitRun(
			root,
			[...raw, "-c", "advice.addEmbeddedRepo=false", "-c", "core.bigFileThreshold=1", "add", "-A", "--", ":/"],
			options,
		);
		return { indexTree, headTree: await tree() };
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

/**
 * Resolve a target to immutable trees. Committed targets read only refs; mutable targets write their new blobs
 * and trees to `objects` (a private directory unless supplied). Close the change to remove private objects.
 */
export async function openGitChange(
	cwd: string,
	target: GitTarget,
	options: { signal?: AbortSignal; objects?: string } = {},
): Promise<GitChange> {
	const { signal } = options;
	const located = await locate(cwd, target, signal).catch((error: Error) => {
		throw new Error(`Cannot resolve the Git target: ${error.message}`);
	});
	const { repository: root, commonDirectory, objectFormat } = located;
	const mutable = target.kind === "staged" || target.kind === "working-tree";
	const owned = mutable && !options.objects ? await mkdtemp(join(tmpdir(), "git-objects-")) : undefined;
	const objects = options.objects ?? owned;
	const env: NodeJS.ProcessEnv = objects
		? { GIT_OBJECT_DIRECTORY: objects, GIT_ALTERNATE_OBJECT_DIRECTORIES: join(commonDirectory, "objects") }
		: {};
	try {
		const [base, trees] = await Promise.all([
			resolveBase(root, target, located, signal),
			mutable
				? snapshot(root, located.index, objectFormat, env, target.kind === "working-tree", signal)
				: { headTree: located.head.tree, indexTree: null },
		]);
		return {
			repository: root,
			commonDirectory,
			objectFormat,
			target,
			headCommit: located.head.commit,
			...base,
			...trees,
			...openTrees(root, base.baseTree, trees.headTree, env, owned),
		};
	} catch (error) {
		if (owned) await rm(owned, { recursive: true, force: true });
		throw error;
	}
}

/** Reads two immutable trees in a repository, such as a retained review capture. */
export function openTrees(
	root: string,
	baseTree: string,
	headTree: string,
	env: NodeJS.ProcessEnv = {},
	owned?: string,
) {
	let reader: ReturnType<typeof objectReader> | undefined;
	return {
		env,
		git: (args: string[], options: GitOptions = {}) =>
			gitRun(root, args, { ...options, env: { ...env, ...options.env } }),
		read(side: "before" | "after", path: string) {
			reader ??= objectReader(root, env);
			return reader.read(`${side === "before" ? baseTree : headTree}:${path}`);
		},
		async close() {
			reader?.close();
			if (owned) await rm(owned, { recursive: true, force: true });
		},
	};
}

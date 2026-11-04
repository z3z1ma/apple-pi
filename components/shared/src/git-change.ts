import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Static, Type } from "typebox";
import { type GitOptions, gitBytes } from "./git.js";

export const GIT_TARGET_HELP =
	"The change, by kind: working-tree is tracked, staged and untracked edits against base; staged is the index against HEAD; commit is one commit against its parent (merges need parent); range is exact endpoints; branch is head since its merge base with base, as a pull request shows it.";
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
const AUTHOR_SETTINGS: NodeJS.ProcessEnv = {
	GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
	GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
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

export const rawFlags = (objectFormat: string) => [
	`--attr-source=${EMPTY_TREE[objectFormat]}`,
	"-c",
	"core.attributesFile=/dev/null",
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

const MINIMUM_GIT = [2, 45, 1];
let gitChecked = false;
async function requireGit(signal?: AbortSignal): Promise<void> {
	if (gitChecked) return;
	const output = await gitLine(tmpdir(), ["version"], { signal });
	const found = (/(\d+)\.(\d+)(?:\.(\d+))?/.exec(output) ?? []).slice(1, 4).map((part) => Number(part ?? 0));
	const order =
		MINIMUM_GIT.map((part, index) => (found[index] ?? 0) - part).find((difference) => difference !== 0) ?? 0;
	if (order < 0) throw new Error(`Git ${MINIMUM_GIT.join(".")} or newer is required; found: ${output}`);
	gitChecked = true;
}

function quotedListEntry(path: string): string {
	if (!/[:"\\\n\t]/.test(path)) return path;
	return `"${path.replace(/[\\"]/g, "\\$&").replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`;
}

export function blobId(objectFormat: string, data: Buffer): string {
	return createHash(objectFormat).update(`blob ${data.length}\0`).update(data).digest("hex");
}
export async function fileBlobId(objectFormat: string, path: string, signal?: AbortSignal): Promise<string> {
	const { size } = await stat(path);
	const hash = createHash(objectFormat).update(`blob ${size}\0`);
	for await (const chunk of createReadStream(path, { signal })) hash.update(chunk as Buffer);
	return hash.digest("hex");
}

export function objectReader(cwd: string, env: NodeJS.ProcessEnv = {}, signal?: AbortSignal) {
	const child = spawn("git", [...FLAGS, "cat-file", "--batch", "-Z"], {
		cwd,
		env: { ...process.env, ...ENV, ...env },
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stderr = "";
	let failure: Error | undefined;
	let closing = false;
	const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
	child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
		stderr += chunk;
	});
	child.stdin.on("error", () => {});
	const waiting: (() => void)[] = [];
	const wake = () => {
		for (const waiter of waiting.splice(0)) waiter();
	};
	const fail = (error: Error) => {
		failure ??= error;
		wake();
	};
	child.once("error", fail);
	child.once("close", (code) => fail(new Error(`git cat-file ended: ${stderr.trim() || `exit ${code}`}`)));
	const abort = () => {
		fail(new Error("Git object reading was cancelled"));
		child.kill("SIGKILL");
	};
	signal?.addEventListener("abort", abort, { once: true });
	if (signal?.aborted) abort();
	const chunks: Buffer[] = [];
	let buffered = 0;
	child.stdout.on("data", (chunk: Buffer) => {
		chunks.push(chunk);
		buffered += chunk.length;
		wake();
	});
	const available = async (size: number) => {
		while (buffered < size) {
			if (failure) throw failure;
			await new Promise<void>((resolve) => waiting.push(resolve));
		}
	};
	const take = (size: number) => {
		const parts: Buffer[] = [];
		let remaining = size;
		while (remaining) {
			const first = chunks[0]!;
			if (first.length <= remaining) {
				parts.push(chunks.shift()!);
				remaining -= first.length;
			} else {
				parts.push(first.subarray(0, remaining));
				chunks[0] = first.subarray(remaining);
				remaining = 0;
			}
		}
		buffered -= size;
		return parts.length === 1 ? parts[0]! : Buffer.concat(parts, size);
	};
	const headerLength = async () => {
		for (;;) {
			let offset = 0;
			for (const chunk of chunks) {
				const end = chunk.indexOf(0);
				if (end >= 0) return offset + end;
				offset += chunk.length;
			}
			await available(buffered + 1);
		}
	};
	let queue: Promise<unknown> = Promise.resolve();
	const request = async (spec: string): Promise<Buffer | undefined> => {
		if (closing) throw new Error("The Git object reader is closed");
		if (failure) throw failure;
		if (spec.includes("\0")) throw new Error("Git object names cannot contain NUL");
		child.stdin.write(`${spec}\0`);
		const end = await headerLength();
		const header = take(end + 1)
			.subarray(0, end)
			.toString("utf8");
		const [, type, length, ...rest] = header.split(" ");
		if (length === undefined || rest.length || !/^\d+$/.test(length)) return undefined;
		const size = Number(length);
		await available(size + 1);
		const data = Buffer.from(take(size));
		if (take(1)[0] !== 0) throw new Error("Invalid Git object terminator");
		return type === "blob" ? data : undefined;
	};
	return {
		read(spec: string): Promise<Buffer | undefined> {
			if (closing) return Promise.reject(new Error("The Git object reader is closed"));
			const next = queue.then(() => request(spec));
			queue = next.catch(() => {});
			return next;
		},
		async close(): Promise<void> {
			closing = true;
			signal?.removeEventListener("abort", abort);
			child.stdin.end();
			if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			await exited;
			await queue;
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
	indexTree: string | null;
	indexEntries: IndexEntry[] | null;
	git(args: string[], options?: GitOptions): Promise<Buffer>;
	read(side: "before" | "after", path: string): Promise<Buffer | undefined>;
	close(): Promise<void>;
}
export interface IndexEntry {
	path: string;
	mode: string;
	blob: string;
}

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export async function settledAll<T extends readonly unknown[]>(work: { [K in keyof T]: Promise<T[K]> }): Promise<T> {
	const results = await Promise.allSettled(work);
	const failed = results.find((result) => result.status === "rejected");
	if (failed) throw (failed as PromiseRejectedResult).reason;
	return results.map((result) => (result as PromiseFulfilledResult<unknown>).value) as unknown as T;
}

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
	const path = (args: string[], from = cwd) =>
		gitLine(from, ["rev-parse", "--path-format=absolute", ...args], { signal });
	const repository = await path(["--show-toplevel"]);
	const [commonDirectory, gitDirectory, ids] = await settledAll([
		path(["--git-common-dir"], repository),
		path(["--absolute-git-dir"], repository),
		gitLine(
			repository,
			[
				"rev-parse",
				"--show-object-format",
				"--end-of-options",
				...names.flatMap((name) => [`${name}^{commit}`, `${name}^{tree}`]),
			],
			{ signal },
		),
	]);
	const [objectFormat, ...lines] = ids.split("\n").filter((line) => line !== "--end-of-options");
	if (lines.length !== names.length * 2 || !lines.every((line) => OBJECT_ID.test(line)))
		throw new Error(`Each endpoint must name exactly one commit: ${names.join(", ")}`);
	const commits = names.map((_, i) => ({ commit: lines[2 * i]!, tree: lines[2 * i + 1]! }));
	return {
		repository,
		commonDirectory,
		gitDirectory,
		objectFormat: objectFormat!,
		head: commits[0]!,
		base: commits[1],
	};
}
type Located = Awaited<ReturnType<typeof locate>>;

async function resolveBase(root: string, target: GitTarget, located: Located, signal?: AbortSignal) {
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

export async function copyIndex(source: string, target: string): Promise<void> {
	try {
		await copyFile(source, target);
		const { atime, mtime } = await stat(source);
		await utimes(target, atime, mtime);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

async function isolatedContext(located: Located, objects: string | undefined) {
	const directory = await mkdtemp(join(tmpdir(), "git-change-"));
	const gitDir = join(directory, "git");
	await mkdir(join(gitDir, "refs"), { recursive: true });
	await mkdir(join(gitDir, "info"));
	const own = objects ?? join(gitDir, "objects");
	await mkdir(own, { recursive: true });
	await writeFile(join(gitDir, "HEAD"), "ref: refs/heads/main\n");
	await writeFile(
		join(gitDir, "config"),
		located.objectFormat === "sha1"
			? "[core]\n\trepositoryformatversion = 0\n\tbare = false\n"
			: `[core]\n\trepositoryformatversion = 1\n\tbare = false\n[extensions]\n\tobjectformat = ${located.objectFormat}\n`,
	);
	await copyFile(join(located.commonDirectory, "info", "exclude"), join(gitDir, "info", "exclude")).catch(() => {});
	for (const name of await readdir(located.gitDirectory).catch(() => [] as string[]))
		if (name.startsWith("sharedindex.")) await copyFile(join(located.gitDirectory, name), join(gitDir, name));
	const env: NodeJS.ProcessEnv = {
		GIT_DIR: gitDir,
		GIT_WORK_TREE: located.repository,
		GIT_OBJECT_DIRECTORY: own,
		GIT_ALTERNATE_OBJECT_DIRECTORIES: quotedListEntry(join(located.commonDirectory, "objects")),
	};
	return { directory, env };
}

async function pathSettings(root: string, signal?: AbortSignal): Promise<string[]> {
	const output = await gitRun(
		root,
		["config", "-z", "--get-regexp", "^core\\.(ignorecase|precomposeunicode|excludesfile|protecthfs|protectntfs)$"],
		{ signal, env: AUTHOR_SETTINGS },
	).catch(() => Buffer.alloc(0));
	return output
		.toString("utf8")
		.split("\0")
		.filter(Boolean)
		.flatMap((record) => {
			const split = record.indexOf("\n");
			return ["-c", `${record.slice(0, split)}=${record.slice(split + 1)}`];
		});
}

async function convertedPaths(root: string, entries: IndexEntry[], signal?: AbortSignal): Promise<string[]> {
	const files = entries.filter((entry) => entry.mode.startsWith("100"));
	if (!files.length) return [];
	const autocrlf = await gitLine(root, ["config", "--get", "core.autocrlf"], { signal, env: AUTHOR_SETTINGS }).catch(
		() => "false",
	);
	if (autocrlf === "true" || autocrlf === "input") return files.map((entry) => entry.path);
	const output = await gitRun(
		root,
		["check-attr", "-z", "--stdin", "text", "eol", "crlf", "filter", "ident", "working-tree-encoding"],
		{ signal, env: AUTHOR_SETTINGS, input: files.map((entry) => `${entry.path}\0`).join("") },
	);
	const fields = output.toString("utf8").split("\0");
	const converted = new Set<string>();
	for (let i = 0; i + 2 < fields.length; i += 3)
		if (fields[i + 2] !== "unspecified" && fields[i + 2] !== "unset") converted.add(fields[i]!);
	return [...converted];
}

function parseEntries(output: Buffer): IndexEntry[] {
	return output
		.toString("utf8")
		.split("\0")
		.filter(Boolean)
		.map((record) => {
			const tab = record.indexOf("\t");
			const [mode, blob, stage] = record.slice(0, tab).split(" ");
			if (stage !== "0") throw new Error("Resolve index conflicts before selecting staged or working-tree changes");
			return { path: record.slice(tab + 1), mode: mode!, blob: blob! };
		});
}

async function snapshot(located: Located, env: NodeJS.ProcessEnv, working: boolean, signal?: AbortSignal) {
	const { repository: root, objectFormat } = located;
	const index = join(env.GIT_DIR!, "index");
	await copyIndex(join(located.gitDirectory, "index"), index);
	const raw = [...rawFlags(objectFormat), "-c", "index.sparse=false"];
	const options = { signal, env: { ...env, GIT_INDEX_FILE: index } };
	const run = (args: string[], extra: GitOptions = {}) => gitRun(root, [...raw, ...args], { ...options, ...extra });
	const indexEntries = parseEntries(await run(["ls-files", "--stage", "-z"]));
	const indexTree = (await run(["write-tree"])).toString("utf8").trim();
	if (!working) return { indexTree, indexEntries, headTree: indexTree };
	const tagged = (await run(["ls-files", "-v", "-z"])).toString("utf8").split("\0").filter(Boolean);
	for (const [option, flagged] of [
		["--no-assume-unchanged", tagged.filter((record) => /^[a-z]/.test(record))],
		["--no-skip-worktree", tagged.filter((record) => record[0] === "S" || record[0] === "s")],
	] as const)
		if (flagged.length)
			await run(["update-index", "-z", option, "--stdin"], {
				input: flagged.map((record) => `${record.slice(2)}\0`).join(""),
			});
	const stale: IndexEntry[] = [];
	const byPath = new Map(indexEntries.map((entry) => [entry.path, entry]));
	for (const path of await convertedPaths(root, indexEntries, signal)) {
		signal?.throwIfAborted();
		const entry = byPath.get(path)!;
		const file = join(root, path);
		const present = await lstat(file).catch(() => undefined);
		if (present?.isFile() && (await fileBlobId(objectFormat, file)) !== entry.blob) stale.push(entry);
	}
	if (stale.length)
		await run(["update-index", "-z", "--index-info"], {
			input: stale.map((entry) => `${entry.mode} ${entry.blob} 0\t${entry.path}\0`).join(""),
		});
	const settings = await pathSettings(root, signal);
	await run([
		...settings,
		"-c",
		"advice.addEmbeddedRepo=false",
		"-c",
		"core.bigFileThreshold=1",
		"add",
		"-A",
		"--",
		":/",
	]);
	return { indexTree, indexEntries, headTree: (await run(["write-tree"])).toString("utf8").trim() };
}

export async function openGitChange(
	cwd: string,
	target: GitTarget,
	options: { signal?: AbortSignal; objects?: string } = {},
): Promise<GitChange> {
	const { signal } = options;
	await requireGit(signal);
	const located = await locate(cwd, target, signal).catch((error: Error) => {
		throw new Error(`Cannot resolve the Git target: ${error.message}`);
	});
	const mutable = target.kind === "staged" || target.kind === "working-tree";
	const context = await isolatedContext(located, options.objects);
	try {
		const [base, trees] = await settledAll([
			resolveBase(located.repository, target, located, signal),
			mutable
				? snapshot(located, context.env, target.kind === "working-tree", signal)
				: Promise.resolve({ headTree: located.head.tree, indexTree: null, indexEntries: null as IndexEntry[] | null }),
		]);
		return {
			repository: located.repository,
			commonDirectory: located.commonDirectory,
			objectFormat: located.objectFormat,
			target,
			headCommit: located.head.commit,
			...base,
			...trees,
			...openTrees(located.repository, base.baseTree, trees.headTree, {
				env: context.env,
				owned: context.directory,
				signal,
			}),
		};
	} catch (error) {
		await rm(context.directory, { recursive: true, force: true });
		throw error;
	}
}

export function openTrees(
	root: string,
	baseTree: string,
	headTree: string,
	options: { env?: NodeJS.ProcessEnv; owned?: string; signal?: AbortSignal } = {},
) {
	const env = options.env ?? {};
	const stop = new AbortController();
	const signal = options.signal ? AbortSignal.any([options.signal, stop.signal]) : stop.signal;
	const active = new Set<Promise<unknown>>();
	let reader: ReturnType<typeof objectReader> | undefined;
	let closed: Promise<void> | undefined;
	return {
		git: (args: string[], extra: GitOptions = {}) => {
			if (closed) return Promise.reject(new Error("The Git change is closed"));
			const command = gitRun(root, [`--attr-source=${headTree}`, "-c", "core.attributesFile=/dev/null", ...args], {
				...extra,
				signal: extra.signal ? AbortSignal.any([extra.signal, signal]) : signal,
				env: { ...env, ...extra.env },
			});
			active.add(command);
			void command.catch(() => {}).finally(() => active.delete(command));
			return command;
		},
		read(side: "before" | "after", path: string) {
			if (closed) return Promise.reject(new Error("The Git change is closed"));
			reader ??= objectReader(root, env, signal);
			return reader.read(`${side === "before" ? baseTree : headTree}:${path}`);
		},
		close(): Promise<void> {
			closed ??= (async () => {
				if (active.size) stop.abort(new Error("The Git change was closed"));
				await Promise.allSettled([...active]);
				await reader?.close();
				if (options.owned) await rm(options.owned, { recursive: true, force: true });
			})();
			return closed;
		},
	};
}

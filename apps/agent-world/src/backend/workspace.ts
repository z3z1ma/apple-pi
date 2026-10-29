import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	chmodSync,
	closeSync,
	fsyncSync,
	lstatSync,
	openSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
	WorkspaceApi,
	WorkspaceGitEntry,
	WorkspacePath,
	WorkspaceResult,
	WorkspaceSave,
	WorkspaceWorktree,
} from "../workspace.js";
import type { WorldSnapshot } from "../world.js";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const failure = (error: unknown) => ({
	ok: false as const,
	reason: error instanceof Error ? error.message : String(error),
});
function within(root: string, path: string) {
	const rel = relative(root, path);
	if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
		throw new Error("The path is outside the workspace root.");
	if (rel.split(sep).includes(".git")) throw new Error("Git metadata is not available in the file editor.");
}
function directory(root: string) {
	if (!isAbsolute(root)) throw new Error("Choose an absolute workspace directory.");
	const canonical = realpathSync(root);
	if (canonical.split(sep).includes(".git")) throw new Error("Git metadata is not available in the file editor.");
	if (!statSync(canonical).isDirectory()) throw new Error("The workspace root is not a directory.");
	return canonical;
}
function locate(request: WorkspacePath) {
	const root = directory(request.root);
	if (isAbsolute(request.path) || request.path.includes("\0")) throw new Error("Use a relative file path.");
	const named = resolve(root, request.path);
	within(root, named);
	const path = realpathSync(named);
	within(root, path);
	return { root, path, named };
}
function bytesAt(path: string) {
	if (!statSync(path).isFile()) throw new Error("Choose a regular file.");
	return readFileSync(path);
}
function textOf(bytes: Buffer) {
	if (bytes.includes(0)) throw new Error("Binary files cannot be edited here.");
	try {
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
	} catch {
		throw new Error("This file is not valid UTF-8 text.");
	}
}
async function attempt<T>(action: () => T | Promise<T>): Promise<WorkspaceResult<T>> {
	try {
		return { ok: true, ...(await action()) };
	} catch (error) {
		return failure(error);
	}
}

function git(root: string, args: string[], allowDetached = false): Promise<string> {
	return new Promise((resolve, reject) => {
		const env = { ...process.env, LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
		for (const key of Object.keys(env))
			if (key.startsWith("GIT_") && !["GIT_OPTIONAL_LOCKS", "GIT_TERMINAL_PROMPT"].includes(key))
				delete env[key as keyof typeof env];
		const child = spawn("git", ["--no-pager", "-c", "core.fsmonitor=false", "-C", root, ...args], {
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const out: Buffer[] = [],
			err: Buffer[] = [];
		child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0 || (allowDetached && code === 1)
				? resolve(Buffer.concat(out).toString("utf8"))
				: reject(new Error(Buffer.concat(err).toString("utf8").trim() || `Git exited with ${code}.`)),
		);
	});
}

async function gitRoot(root: string) {
	return directory((await git(root, ["rev-parse", "--show-toplevel"])).replace(/\n$/, ""));
}

async function repositoryRoot(path: string) {
	const root = directory(path);
	const top = await gitRoot(root);
	if (root !== top) throw new Error(`Open the repository root to view Git changes: ${top}`);
	return root;
}

function listedFile(root: string, path: string): boolean {
	const named = resolve(root, path);
	try {
		within(root, named);
	} catch {
		return false;
	}
	let canonical: string;
	try {
		if (!lstatSync(named).isFile()) return false;
		canonical = realpathSync(named);
	} catch (error) {
		if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
		throw error;
	}
	try {
		within(root, canonical);
		return true;
	} catch {
		return false;
	}
}

function folderFiles(root: string): string[] {
	const folders = [root];
	const paths: string[] = [];
	while (folders.length) {
		const folder = folders.pop()!;
		if (!lstatSync(folder).isDirectory()) continue;
		const canonical = realpathSync(folder);
		try {
			within(root, canonical);
		} catch {
			continue;
		}
		for (const entry of readdirSync(canonical, { withFileTypes: true })) {
			if (entry.name === ".git") continue;
			const path = join(canonical, entry.name);
			if (entry.isDirectory()) folders.push(path);
			else if (entry.isFile() && listedFile(root, path)) paths.push(relative(root, path));
		}
	}
	return paths.sort();
}

async function workspaceFiles(root: string): Promise<string[]> {
	let inside: string;
	try {
		inside = await git(root, ["rev-parse", "--is-inside-work-tree"]);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("fatal: not a git repository")) return folderFiles(root);
		throw error;
	}
	if (inside.trim() !== "true") throw new Error("Choose a working directory, not a bare Git repository.");
	const paths = (await git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])).split("\0");
	return [...new Set(paths.filter((path) => path && listedFile(root, path)))].sort();
}

function parseWorktrees(output: string, root: string): WorkspaceWorktree[] {
	return output
		.split("\0\0")
		.filter(Boolean)
		.map((record) => {
			const fields = record.split("\0");
			const value = (key: string) =>
				fields.find((field) => field === key || field.startsWith(`${key} `))?.slice(key.length + 1);
			const path = value("worktree");
			if (!path) throw new Error("Git returned a worktree without a path.");
			const locked = value("locked"),
				prunable = value("prunable");
			return {
				path,
				branch: value("branch")?.replace(/^refs\/heads\//, "") ?? null,
				head: value("HEAD") ?? null,
				detached: fields.includes("detached"),
				bare: fields.includes("bare"),
				current: path === root,
				...(locked !== undefined ? { locked } : {}),
				...(prunable !== undefined ? { prunable } : {}),
			};
		});
}

function save(request: WorkspaceSave): WorkspaceResult<{ hash: string }> {
	let temporary: string | undefined;
	try {
		const at = locate(request);
		if (lstatSync(at.named).isSymbolicLink()) throw new Error("Open the symlink target directly before saving.");
		const before = statSync(at.path);
		const bytes = bytesAt(at.path);
		textOf(bytes);
		if (hash(bytes) !== request.baseHash)
			return { ok: false, conflict: true, reason: "The file changed on disk. Reload before saving." };
		const next = Buffer.from(request.text, "utf8");
		textOf(next);
		temporary = join(dirname(at.path), `.workspace-save-${randomUUID()}`);
		const fd = openSync(temporary, "wx", before.mode);
		try {
			writeFileSync(fd, next);
			chmodSync(temporary, before.mode);
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		const current = locate(request);
		const now = statSync(current.path);
		if (
			current.path !== at.path ||
			lstatSync(current.named).isSymbolicLink() ||
			before.ino !== now.ino ||
			before.dev !== now.dev ||
			before.mode !== now.mode ||
			hash(bytesAt(current.path)) !== request.baseHash
		)
			return { ok: false, conflict: true, reason: "The file changed while saving. Reload before saving." };
		renameSync(temporary, at.path);
		temporary = undefined;
		return { ok: true, hash: hash(next) };
	} catch (error) {
		return failure(error);
	} finally {
		if (temporary) unlinkSync(temporary);
	}
}

export function openWorkspace(snapshot: () => WorldSnapshot): WorkspaceApi {
	return {
		repositories: () =>
			attempt(async () => {
				const world = snapshot();
				const candidates = new Set(
					[
						...world.characters.map((person) => person.facts?.cwd),
						...(world.dormant ?? []).map((person) => person.cwd),
					].filter((cwd): cwd is string => Boolean(cwd)),
				);
				const roots = new Set<string>();
				for (const candidate of candidates) {
					try {
						roots.add(await gitRoot(directory(candidate)));
					} catch {
						/* A retained session directory can be missing or no longer be a repository. Manual paths remain available. */
					}
				}
				return { roots: [...roots].sort() };
			}),
		files: (request) =>
			attempt(async () => {
				const root = directory(request.root);
				return { root, paths: await workspaceFiles(root) };
			}),
		worktrees: (request) =>
			attempt(async () => {
				const root = await gitRoot(directory(request.root));
				return { root, worktrees: parseWorktrees(await git(root, ["worktree", "list", "--porcelain", "-z"]), root) };
			}),
		tree: (request) =>
			attempt(() => {
				const at = locate(request);
				const entries = readdirSync(at.path, { withFileTypes: true })
					.filter((entry) => entry.name !== ".git")
					.map((entry) => ({
						name: entry.name,
						path: join(request.path, entry.name),
						kind: entry.isDirectory()
							? ("directory" as const)
							: entry.isFile()
								? ("file" as const)
								: entry.isSymbolicLink()
									? ("symlink" as const)
									: ("other" as const),
					}));
				entries.sort(
					(a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.name.localeCompare(b.name),
				);
				return { root: at.root, path: request.path, entries };
			}),
		readFile: (request) =>
			attempt(() => {
				const at = locate(request);
				const bytes = bytesAt(at.path);
				return { root: at.root, path: request.path, text: textOf(bytes), hash: hash(bytes) };
			}),
		saveFile: async (request) => save(request),
		gitStatus: (request) =>
			attempt(async () => {
				const root = await repositoryRoot(request.root);
				const output = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
				const records = output.split("\0");
				const entries: WorkspaceGitEntry[] = [];
				for (let i = 0; i < records.length; i++) {
					const record = records[i];
					if (!record) continue;
					const entry: WorkspaceGitEntry = { path: record.slice(3), index: record[0], worktree: record[1] };
					if (/[RC]/.test(record.slice(0, 2))) entry.previousPath = records[++i];
					entries.push(entry);
				}
				const branch = (await git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], true)).trim() || null;
				return { entries, branch };
			}),
		gitDiff: (request) =>
			attempt(async () => {
				const root = await repositoryRoot(request.root);
				if (isAbsolute(request.path) || !request.path || request.path.includes("\0"))
					throw new Error("Choose a relative file path for the diff.");
				within(root, resolve(root, request.path));
				return {
					text: await git(root, [
						"diff",
						"--no-ext-diff",
						"--no-textconv",
						...(request.staged ? ["--cached"] : []),
						"--",
						`:(literal)${request.path}`,
					]),
				};
			}),
	};
}

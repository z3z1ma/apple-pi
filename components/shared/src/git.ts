import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Git and repository-copy helpers shared by branch search and the history evaluation. */

export interface GitOptions {
	env?: NodeJS.ProcessEnv;
	/** Written to git's stdin. */
	input?: string | Uint8Array;
	signal?: AbortSignal;
	/** Directory to run in; defaults to the cwd argument. */
	cwd?: string;
	/** Fail and stop the command once it has run this long. */
	timeoutMs?: number;
	/** Fail and stop the command as soon as stdout exceeds this many bytes. */
	maxBytes?: number;
}

/** Time between asking a stopped Git process group to exit and killing it. */
const KILL_GRACE_MS = 2000;

export async function git(cwd: string, args: string[], options: GitOptions = {}): Promise<string> {
	return (await gitBytes(cwd, args, options)).toString("utf8").trim();
}

/**
 * Exact bytes for blobs, patches and NUL-delimited paths; the text helper intentionally trims. The command runs in
 * its own process group, and every failure path (exit, abort, deadline, output limit) settles only after the
 * process has exited, so callers can remove the directories it was using.
 */
export function gitBytes(cwd: string, args: string[], options: GitOptions = {}): Promise<Buffer> {
	return new Promise((resolvePromise, reject) => {
		if (options.signal?.aborted) {
			reject(options.signal.reason ?? new Error("git was cancelled before it started"));
			return;
		}
		const child = spawn("git", args, {
			cwd: options.cwd ?? cwd,
			// No optional locks: status-like reads never refresh the user's index.
			env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", ...options.env },
			detached: process.platform !== "win32",
			stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
		});
		const chunks: Buffer[] = [];
		let size = 0;
		let stderr = "";
		let failure: Error | undefined;
		let escalation: ReturnType<typeof setTimeout> | undefined;
		const signalGroup = (name: NodeJS.Signals) => {
			try {
				if (child.pid && process.platform !== "win32") process.kill(-child.pid, name);
				else child.kill(name);
			} catch {}
		};
		const stop = (reason: Error) => {
			if (failure) return;
			failure = reason;
			signalGroup("SIGTERM");
			// A process that ignores TERM must not keep a deadline or cancellation pending forever.
			escalation = setTimeout(() => signalGroup("SIGKILL"), KILL_GRACE_MS);
		};
		const abort = () =>
			stop(
				options.signal?.reason instanceof Error
					? options.signal.reason
					: new Error(`git ${args.join(" ")} was aborted`),
			);
		const timer = options.timeoutMs
			? setTimeout(
					() => stop(new Error(`git ${args.join(" ")} timed out after ${options.timeoutMs} ms`)),
					options.timeoutMs,
				)
			: undefined;
		options.signal?.addEventListener("abort", abort, { once: true });
		child.stdout!.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (options.maxBytes !== undefined && size > options.maxBytes)
				stop(new Error(`git ${args.join(" ")} output exceeded ${options.maxBytes} bytes; narrow the paths`));
			else if (!failure) chunks.push(chunk);
		});
		child.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
			if (options.maxBytes !== undefined && stderr.length + chunk.length > options.maxBytes)
				stop(new Error(`git ${args.join(" ")} error output exceeded ${options.maxBytes} bytes`));
			else if (!failure) stderr += chunk;
		});
		child.once("error", (error) => stop(error));
		child.once("close", (code) => {
			if (timer) clearTimeout(timer);
			if (escalation) clearTimeout(escalation);
			options.signal?.removeEventListener("abort", abort);
			if (failure) reject(failure);
			else if (code !== 0) reject(new Error(`git ${args.join(" ")} failed: ${stderr.trim() || `exit ${code}`}`));
			else resolvePromise(Buffer.concat(chunks, size));
		});
		if (options.input !== undefined) {
			child.stdin!.on("error", () => {});
			child.stdin!.end(options.input);
		}
	});
}

/** The repository root in the session's spelling of the path, which is the one the model sees. */
export async function repoRoot(cwd: string): Promise<string> {
	return resolve(cwd, await git(cwd, ["rev-parse", "--show-cdup"]));
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

/** Clone each listed ignored directory of `root` that exists into `path`, unless `path` already has it. */
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

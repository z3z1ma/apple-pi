import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface GitOptions {
	env?: NodeJS.ProcessEnv;
	input?: string | Uint8Array;
	signal?: AbortSignal;
	cwd?: string;
	timeoutMs?: number;
	maxBytes?: number;
}

const KILL_GRACE_MS = 2000;

export async function git(cwd: string, args: string[], options: GitOptions = {}): Promise<string> {
	return (await gitBytes(cwd, args, options)).toString("utf8").trim();
}

export function gitBytes(cwd: string, args: string[], options: GitOptions = {}): Promise<Buffer> {
	return new Promise((resolvePromise, reject) => {
		if (options.signal?.aborted) {
			reject(options.signal.reason ?? new Error("git was cancelled before it started"));
			return;
		}
		const child = spawn("git", args, {
			cwd: options.cwd ?? cwd,
			env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", ...options.env },
			detached: process.platform !== "win32",
			stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
		});
		const chunks: Buffer[] = [];
		const errors: Buffer[] = [];
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
		let output = 0;
		const collect = (target: Buffer[], chunk: Buffer) => {
			output += chunk.length;
			if (options.maxBytes !== undefined && output > options.maxBytes)
				stop(new Error(`git ${args.join(" ")} output exceeded ${options.maxBytes} bytes; narrow the paths`));
			else if (!failure) target.push(chunk);
		};
		child.stdout!.on("data", (chunk: Buffer) => collect(chunks, chunk));
		child.stderr!.on("data", (chunk: Buffer) => collect(errors, chunk));
		child.once("error", (error) => stop(error));
		child.once("close", (code) => {
			if (timer) clearTimeout(timer);
			if (escalation) clearTimeout(escalation);
			options.signal?.removeEventListener("abort", abort);
			const stderr = Buffer.concat(errors).toString("utf8");
			if (failure) void groupGone(child.pid).then(() => reject(failure));
			else if (code !== 0) reject(new Error(`git ${args.join(" ")} failed: ${stderr.trim() || `exit ${code}`}`));
			else resolvePromise(Buffer.concat(chunks));
		});
		if (options.input !== undefined) {
			child.stdin!.on("error", () => {});
			child.stdin!.end(options.input);
		}
	});
}

async function groupGone(pid: number | undefined): Promise<void> {
	if (!pid || process.platform === "win32") return;
	for (;;) {
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			return;
		}
		await new Promise((resolveWait) => setTimeout(resolveWait, 20));
	}
}

export async function repoRoot(cwd: string): Promise<string> {
	return resolve(cwd, await git(cwd, ["rev-parse", "--show-cdup"]));
}

function cloneCommand(source: string, target: string): [string, string[]] {
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

import { spawn } from "node:child_process";

export interface CommandResult {
	exitCode: number | null;
	timedOut: boolean;
	stdout: string;
	stderr: string;
	ms: number;
}

/** Each command keeps this much of the end of its stdout and of its stderr. */
export const OUTPUT_TAIL_BYTES = 64 * 1024;

/** Collects a stream, keeping only its last OUTPUT_TAIL_BYTES bytes. */
function tail() {
	let kept = Buffer.alloc(0);
	return {
		add(chunk: Buffer) {
			kept = Buffer.concat([kept, chunk]);
			if (kept.length > OUTPUT_TAIL_BYTES) kept = kept.subarray(kept.length - OUTPUT_TAIL_BYTES);
		},
		text: () => kept.toString("utf8"),
	};
}

/**
 * Run a command with `bash -lc` in `cwd`. The command gets its own process group, which a timeout or
 * the abort signal kills whole. When the command settles, anything it left running in that group is
 * killed too.
 */
export function runCommand(
	command: string,
	cwd: string,
	env: NodeJS.ProcessEnv,
	options: { timeoutSec?: number; signal?: AbortSignal } = {},
): Promise<CommandResult> {
	const { timeoutSec, signal } = options;
	const started = Date.now();
	return new Promise((resolvePromise, reject) => {
		const child = spawn("bash", ["-lc", command], {
			cwd,
			env: { ...process.env, ...env },
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const [stdout, stderr] = [tail(), tail()];
		let timedOut = false;
		child.stdout.on("data", stdout.add);
		child.stderr.on("data", stderr.add);
		const kill = () => {
			try {
				if (child.pid) process.kill(-child.pid, "SIGKILL");
			} catch {
				// The group already exited.
			}
		};
		const timer =
			timeoutSec === undefined
				? undefined
				: setTimeout(() => {
						timedOut = true;
						kill();
					}, timeoutSec * 1000);
		signal?.addEventListener("abort", kill, { once: true });
		// An abort that fired before the listener existed would otherwise be missed.
		if (signal?.aborted) kill();
		const settle = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", kill);
			kill();
		};
		child.on("error", (error) => {
			settle();
			reject(error);
		});
		child.on("close", (exitCode) => {
			settle();
			resolvePromise({ exitCode, timedOut, stdout: stdout.text(), stderr: stderr.text(), ms: Date.now() - started });
		});
	});
}

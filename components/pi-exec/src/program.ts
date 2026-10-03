import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
	CollectString,
	Monty,
	MontyCrashedError,
	MontyRuntimeError,
	type MontySession,
	MontyTypingError,
	ProtocolError,
} from "@pydantic/monty";
import { PROGRAM_ENVELOPE_MAXIMA } from "./envelope.js";
import { guestFunctions } from "./guest-functions.js";
import { fromPythonValue } from "./json.js";
import { PYTHON_SCHEMA_PRELUDE } from "./python-schema.js";
import type { ProgramExecution, ProgramHostCall } from "./types.js";

function keyboardInterrupt(): Error {
	const error = new Error("pi_exec aborted");
	error.name = "KeyboardInterrupt";
	return error;
}

export async function createProgramSession(
	stubs: string,
	dump?: Uint8Array,
): Promise<{ session: MontySession; close(): Promise<void> }> {
	const pool = await Monty.create({ minProcesses: 0, maxProcesses: 1 });
	let session: MontySession | undefined;
	try {
		session = await pool.checkout({
			limits: {
				maxMemory: PROGRAM_ENVELOPE_MAXIMA.memoryMb * 1024 * 1024,
				maxTurnDurationSecs: PROGRAM_ENVELOPE_MAXIMA.timeoutSeconds,
				maxFeedDurationSecs: PROGRAM_ENVELOPE_MAXIMA.timeoutSeconds,
				maxSuspensions: (PROGRAM_ENVELOPE_MAXIMA.callBudget + 1) * 2,
			},
			typeCheck: true,
			typeCheckStubs: stubs,
		});
		if (dump) await session.loadSession(dump);
		else await session.feedRun(PYTHON_SCHEMA_PRELUDE);
		const live = session;
		return {
			session: live,
			async close() {
				try {
					await live.close();
				} finally {
					await pool.close();
				}
			},
		};
	} catch (error) {
		try {
			await session?.close();
		} finally {
			await pool.close();
		}
		throw error;
	}
}

/** Run one Python feed against the root session's live Monty interpreter. */
export async function executeProgram(
	session: MontySession,
	code: string,
	inputs: Record<string, string>,
	timeoutMs: number,
	hostCall: ProgramHostCall,
	signal?: AbortSignal,
	onLog?: (values: unknown[]) => void,
	onInterrupt?: () => void,
): Promise<ProgramExecution> {
	if (signal?.aborted) return { outcome: "aborted", error: "pi_exec aborted", sessionUsable: false };
	const controller = new AbortController();
	const pending = new Set<(reason: Error) => void>();
	let timedOut = false;
	let feedSettled = true;
	let rejectStopped: (reason: Error) => void = () => {};
	const stopped = new Promise<never>((_resolve, reject) => {
		rejectStopped = reject;
	});
	const stop = () => {
		if (controller.signal.aborted) return;
		controller.abort();
		if (!feedSettled) onInterrupt?.();
		for (const reject of pending) reject(keyboardInterrupt());
		rejectStopped(keyboardInterrupt());
	};
	const timer = setTimeout(() => {
		timedOut = true;
		stop();
	}, timeoutMs);
	timer.unref?.();
	signal?.addEventListener("abort", stop, { once: true });
	if (signal?.aborted) stop();
	const collector = new (class extends CollectString {
		override write(stream: "stdout" | "stderr", text: string) {
			try {
				super.write(stream, text);
			} catch (error) {
				if (error instanceof MontyRuntimeError && error.exception.typeName === "MemoryError")
					throw new MontyRuntimeError("MemoryError", `Captured print output limit exceeded (10 MiB): ${error.message}`);
				throw error;
			}
		}
	})();
	const invoke = (ref: string, args: Record<string, unknown> = {}) => {
		const converted = fromPythonValue(args, true) as Record<string, unknown>;
		return new Promise<unknown>((resolve, reject) => {
			if (controller.signal.aborted) return reject(keyboardInterrupt());
			pending.add(reject);
			void hostCall(ref, converted, controller.signal)
				.then((value) => resolve(value === undefined ? null : value), reject)
				.finally(() => pending.delete(reject));
		});
	};
	const externalLookup = guestFunctions(invoke, () => (controller.signal.aborted ? keyboardInterrupt() : undefined));
	try {
		if (controller.signal.aborted) throw keyboardInterrupt();
		const feed = session.feedRun(code, { inputs: { inputs }, externalLookup, printCallback: collector });
		feedSettled = false;
		void feed.then(
			() => {
				feedSettled = true;
			},
			() => {
				feedSettled = true;
			},
		);
		const result = await Promise.race([feed, stopped]);
		if (timedOut)
			return { outcome: "timed_out", error: `pi_exec timed out after ${timeoutMs}ms`, sessionUsable: false };
		if (controller.signal.aborted) return { outcome: "aborted", error: "pi_exec aborted", sessionUsable: false };
		return { outcome: "succeeded", value: fromPythonValue(result), sessionUsable: true };
	} catch (error) {
		if (timedOut)
			return { outcome: "timed_out", error: `pi_exec timed out after ${timeoutMs}ms`, sessionUsable: false };
		if (controller.signal.aborted || signal?.aborted)
			return { outcome: "aborted", error: "pi_exec aborted", sessionUsable: false };
		if (error instanceof MontyRuntimeError && error.exception.typeName === "TimeoutError")
			return {
				outcome: "timed_out",
				error: `pi_exec timed out after ${timeoutMs}ms: ${error.display()}`,
				sessionUsable: false,
			};
		if (error instanceof MontyCrashedError && error.timedOut)
			return { outcome: "timed_out", error: error.message, sessionUsable: false };
		const terminal =
			error instanceof MontyCrashedError ||
			error instanceof ProtocolError ||
			(error instanceof MontyRuntimeError &&
				(error.exception.typeName === "MemoryError" || /suspension limit/i.test(error.message)));
		return {
			outcome: "failed",
			error:
				error instanceof MontyTypingError ? error.display() : error instanceof Error ? error.message : String(error),
			sessionUsable: !terminal,
		};
	} finally {
		stop();
		clearTimeout(timer);
		signal?.removeEventListener("abort", stop);
		const output = collector.output;
		if (output) onLog?.([output.trimEnd()]);
	}
}

export function isOwnedMontyWorker(pid: number | undefined): boolean {
	if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
	if (process.platform === "win32") {
		try {
			const tasklist = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tasklist.exe");
			const output = execFileSync(tasklist, ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 1_000,
			}).trim();
			return output.toLowerCase().includes("monty.exe");
		} catch {
			return false;
		}
	}
	try {
		const output = execFileSync("ps", ["-p", String(pid), "-o", "ppid=,command="], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 1_000,
		}).trim();
		const [ppidStr, ...rest] = output.split(/\s+/);
		const ppid = Number(ppidStr);
		const command = rest.join(" ");
		return ppid === process.pid && command.includes("monty") && command.includes("subprocess");
	} catch {
		return false;
	}
}

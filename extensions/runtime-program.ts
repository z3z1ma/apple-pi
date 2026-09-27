import { CollectString, Monty, MontyCrashedError, MontyRuntimeError, MontyTypingError } from "@pydantic/monty";
import { corePythonStubs, CORE_GUEST_TOOL_NAMES } from "./runtime-api.js";
import type { ProgramExecution, ProgramHostCall } from "./runtime-types.js";

function jsonValue(value: unknown, seen = new Set<object>(), hostArguments = false): unknown {
	if (
		!hostArguments &&
		typeof value === "string" &&
		(/^<function .+ at 0x[0-9a-f]+>$/.test(value) || ["[...]", "{...}", "(...)"].includes(value))
	)
		throw new Error("pi_exec result is not JSON-serializable");
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) return value;
	if (typeof value !== "object" || !value) throw new Error("pi_exec result is not JSON-serializable");
	if (seen.has(value)) throw new Error("pi_exec result contains a cycle");
	seen.add(value);
	try {
		if (Array.isArray(value)) return value.map((item) => jsonValue(item, seen, hostArguments));
		if (
			value instanceof Map ||
			(hostArguments && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null))
		) {
			const result: Record<string, unknown> = Object.create(null);
			for (const [key, item] of value instanceof Map ? value : Object.entries(value)) {
				if (typeof key !== "string") throw new Error("pi_exec result has a non-string dictionary key");
				result[key] = jsonValue(item, seen, hostArguments);
			}
			return result;
		}
		throw new Error("pi_exec result is not JSON-serializable");
	} finally {
		seen.delete(value);
	}
}

function keyboardInterrupt(): Error {
	const error = new Error("pi_exec aborted");
	error.name = "KeyboardInterrupt";
	return error;
}

/** Run a Python snippet with the core Pi tools as capability-scoped host functions. */
export async function executeProgram(
	code: string,
	inputs: Record<string, string>,
	timeoutMs: number,
	hostCall: ProgramHostCall,
	signal?: AbortSignal,
	onLog?: (values: unknown[]) => void,
	memoryMb = 128,
	state: unknown = {},
	callBudget = 128,
): Promise<ProgramExecution> {
	if (signal?.aborted) return { outcome: "aborted", error: "pi_exec aborted" };
	const pool = await Monty.create({ minProcesses: 0, maxProcesses: 1 });
	let session: Awaited<ReturnType<typeof pool.checkout>>;
	try {
		session = await pool.checkout({
			limits: {
				maxMemory: memoryMb * 1024 * 1024,
				maxTurnDurationSecs: timeoutMs / 1_000,
				maxFeedDurationSecs: timeoutMs / 1_000,
				maxTotalSleepSecs: timeoutMs / 1_000,
				// A one-call gather suspends twice; reserve one rejected call for the host budget diagnostic.
				maxSuspensions: (callBudget + 1) * 2,
			},
			typeCheck: true,
			typeCheckStubs: corePythonStubs(),
		});
	} catch (error) {
		await pool.close();
		throw error;
	}
	const controller = new AbortController();
	const pending = new Set<(reason: Error) => void>();
	let timedOut = false;
	let rejectStopped: (reason: Error) => void = () => {};
	const stopped = new Promise<never>((_resolve, reject) => {
		rejectStopped = reject;
	});
	const stop = () => {
		if (controller.signal.aborted) return;
		controller.abort();
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
	const collector = new CollectString(20_000);
	const externalLookup = Object.fromEntries(
		CORE_GUEST_TOOL_NAMES.map((name) => [
			name,
			(args: Record<string, unknown> = {}) =>
				new Promise<unknown>((resolve, reject) => {
					if (controller.signal.aborted) return reject(keyboardInterrupt());
					pending.add(reject);
					void hostCall(`pi.${name}`, jsonValue(args, new Set(), true) as Record<string, unknown>, controller.signal)
						.then((value) => {
							if (value === undefined) resolve(null);
							else resolve(value);
						}, reject)
						.finally(() => pending.delete(reject));
				}),
		]),
	);
	try {
		const result = await Promise.race([
			session.feedRun(code, { inputs: { inputs, state }, externalLookup, printCallback: collector }),
			stopped,
		]);
		if (timedOut) return { outcome: "timed_out", error: `pi_exec timed out after ${timeoutMs}ms` };
		if (controller.signal.aborted) return { outcome: "aborted", error: "pi_exec aborted" };
		const value = jsonValue(result);
		const nextState = jsonValue(await Promise.race([session.feedRun("state"), stopped]));
		const stateChanged = JSON.stringify(nextState) !== JSON.stringify(state);
		return { outcome: "succeeded", value, ...(stateChanged ? { state: nextState, stateChanged } : {}) };
	} catch (error) {
		if (timedOut) return { outcome: "timed_out", error: `pi_exec timed out after ${timeoutMs}ms` };
		if (controller.signal.aborted || signal?.aborted) return { outcome: "aborted", error: "pi_exec aborted" };
		if (error instanceof MontyRuntimeError && error.exception.typeName === "TimeoutError")
			return { outcome: "timed_out", error: `pi_exec timed out after ${timeoutMs}ms: ${error.display()}` };
		if (error instanceof MontyCrashedError && error.timedOut) return { outcome: "timed_out", error: error.message };
		return {
			outcome: "failed",
			error:
				error instanceof MontyTypingError ? error.display() : error instanceof Error ? error.message : String(error),
		};
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", stop);
		const output = collector.output;
		if (output) onLog?.([output.trimEnd()]);
		if (controller.signal.aborted) {
			void Promise.allSettled([session.close(), pool.close()]);
		} else {
			try {
				await session.close();
			} finally {
				await pool.close();
			}
		}
	}
}

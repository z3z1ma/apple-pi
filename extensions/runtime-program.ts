import { Worker } from "node:worker_threads";

import type { ProgramExecution, ProgramHostCall } from "./runtime-types.js";

function serializeHostCallOutcome(ok: boolean, value: unknown): string {
	try {
		return JSON.stringify(
			ok ? { ok: true, value } : { ok: false, error: value instanceof Error ? value.message : String(value) },
			(_key, nested) => (typeof nested === "bigint" ? String(nested) : nested),
		);
	} catch (error) {
		return JSON.stringify({
			ok: false,
			error: `pi_exec host result is not JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
		});
	}
}

/** Execute a JavaScript function body in a disposable worker and bridge host calls. */
export async function executeProgram(
	code: string,
	inputs: Record<string, string>,
	timeoutMs: number,
	hostCall: ProgramHostCall,
	signal?: AbortSignal,
	onLog?: (values: unknown[]) => void,
	memoryMb = 128,
): Promise<ProgramExecution> {
	if (signal?.aborted) return { outcome: "aborted", error: "pi_exec aborted" };
	const controller = new AbortController();
	const worker = new Worker(new URL("./runtime-worker.mjs", import.meta.url), {
		workerData: { code, inputs },
		resourceLimits: { maxOldGenerationSizeMb: memoryMb, stackSizeMb: 4 },
	});
	const hostTasks = new Set<Promise<void>>();
	const hostCallControllers = new Map<number, AbortController>();

	return await new Promise((resolve) => {
		let settled = false;
		let timer: NodeJS.Timeout | undefined;
		const finish = (result: ProgramExecution) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			controller.abort(new Error(result.error ?? "pi_exec completed"));
			void worker.terminate();
			resolve(result);
		};
		const abort = () => finish({ outcome: "aborted", error: "pi_exec aborted" });
		timer = setTimeout(
			() => finish({ outcome: "timed_out", error: `pi_exec timed out after ${timeoutMs}ms` }),
			timeoutMs,
		);
		timer.unref?.();
		if (signal) {
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) abort();
		}

		worker.on("message", (message: any) => {
			if (settled || !message) return;
			if (message.type === "log") {
				onLog?.(Array.isArray(message.values) ? message.values : []);
				return;
			}
			if (message.type === "cancel") {
				hostCallControllers.get(message.id)?.abort(new Error(message.reason || "pi_exec host call aborted"));
				return;
			}
			if (message.type === "call") {
				const callController = new AbortController();
				const relayAbort = () => callController.abort(controller.signal.reason);
				controller.signal.addEventListener("abort", relayAbort, { once: true });
				hostCallControllers.set(message.id, callController);
				const task = hostCall(message.ref, message.args ?? {}, callController.signal)
					.then((value) => {
						if (!settled)
							worker.postMessage({
								type: "call_result",
								id: message.id,
								outcome: serializeHostCallOutcome(true, value),
							});
					})
					.catch((error) => {
						if (!settled)
							worker.postMessage({
								type: "call_result",
								id: message.id,
								outcome: serializeHostCallOutcome(false, error),
							});
					})
					.finally(() => {
						controller.signal.removeEventListener("abort", relayAbort);
						hostCallControllers.delete(message.id);
						hostTasks.delete(task);
					});
				hostTasks.add(task);
				return;
			}
			if (message.type === "failed") {
				finish({ outcome: "failed", error: message.error || "pi_exec program failed" });
				return;
			}
			if (message.type === "done") {
				void Promise.all([...hostTasks]).then(() => {
					finish({ outcome: "succeeded", value: message.value });
				});
			}
		});
		worker.on("error", (error) => finish({ outcome: "failed", error: error.message }));
		worker.on("exit", (code) => {
			if (!settled) finish({ outcome: "failed", error: `pi_exec worker exited with code ${code}` });
		});
	});
}

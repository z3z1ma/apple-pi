import { existsSync } from "node:fs";

/**
 * The cancellation of an evaluation entry. `scripts/eval-run.mjs` owns the operator's SIGINT and SIGTERM:
 * Vitest's main process exits on either at once, and its worker, where the evaluation runs, would be
 * orphaned mid-cleanup. The launcher instead creates the file `APPLE_PI_EVAL_STOP_FILE` names, and this
 * signal aborts once it exists. Without that variable (Vitest run directly) the signal never aborts.
 */
export function evalStopSignal(): { signal: AbortSignal; dispose: () => void } {
	const controller = new AbortController();
	const file = process.env.APPLE_PI_EVAL_STOP_FILE;
	const poll = file
		? setInterval(() => {
				if (existsSync(file)) controller.abort();
			}, 200)
		: undefined;
	// The poll alone never keeps the process alive, so an entry that fails before `dispose` cannot hang.
	poll?.unref();
	return { signal: controller.signal, dispose: () => clearInterval(poll) };
}

#!/usr/bin/env node
/**
 * Runs one real-model evaluation entry through Vitest (`vitest.eval.config.ts`) and owns its cancellation.
 *
 *   node scripts/eval-run.mjs eval/history.eval.ts
 *
 * Vitest's main process exits at once on SIGINT or SIGTERM, which would orphan the worker running the
 * evaluation in the middle of its cleanup. So Vitest runs in its own process group, out of reach of the
 * terminal's signals, and this process turns the first SIGINT or SIGTERM into the stop file that the entry
 * watches (`components/history-eval/src/stop.ts`). The evaluation then stops its runs, removes their
 * directories, closes its sessions, and writes its report; this process exits with Vitest's status. A second
 * signal kills the whole group without cleanup.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vitest = join(dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs");
const stopDir = mkdtempSync(join(tmpdir(), "apple-pi-eval-stop-"));
const stopFile = join(stopDir, "stop");

const child = spawn(
	process.execPath,
	[vitest, "run", "--config", join(root, "vitest.eval.config.ts"), ...process.argv.slice(2)],
	{ stdio: "inherit", detached: true, env: { ...process.env, APPLE_PI_EVAL_STOP_FILE: stopFile } },
);

let signals = 0;
const stop = (signal) => {
	signals++;
	if (signals === 1) {
		console.error(
			`${signal}: stopping the evaluation; it writes the report of what finished. Signal again to kill it.`,
		);
		writeFileSync(stopFile, signal);
	} else if (child.pid !== undefined) {
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch {
			// The group already exited.
		}
	}
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

child.on("error", (error) => {
	rmSync(stopDir, { recursive: true, force: true });
	console.error(error);
	process.exit(1);
});
child.on("exit", (code) => {
	rmSync(stopDir, { recursive: true, force: true });
	process.exit(code ?? 1);
});

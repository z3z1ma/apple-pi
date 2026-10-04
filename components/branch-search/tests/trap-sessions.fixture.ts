import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import type { BenchmarkSessions } from "../eval/traps.js";

/**
 * Faux sessions for the launcher's cancellation test, loaded by `traps.eval.ts` through
 * `APPLE_PI_EVAL_SESSIONS_MODULE`. Every model request is held open until aborted. Markers in
 * `TRAP_FIXTURE_MARKERS`: `cwds` lists each session's directory, `requested` appears at the first request,
 * and `closed` when the benchmark closes the sessions.
 */
export async function openSessions(_model: string): Promise<BenchmarkSessions> {
	const markers = process.env.TRAP_FIXTURE_MARKERS;
	if (!markers) throw new Error("Set TRAP_FIXTURE_MARKERS.");
	return {
		modelLabel: "faux",
		close: () => writeFileSync(join(markers, "closed"), ""),
		async createSession(cwd) {
			appendFileSync(join(markers, "cwds"), `${cwd}\n`);
			const run = await fauxSession(
				[],
				() => {
					writeFileSync(join(markers, "requested"), "");
					return "until-aborted";
				},
				["read"],
				{ cwd },
			);
			return { session: run.session, dispose: run.dispose };
		},
	};
}

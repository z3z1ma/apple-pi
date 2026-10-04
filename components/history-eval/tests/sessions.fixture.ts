import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import type { SessionFactory } from "../src/run.js";

/**
 * Faux sessions for the launcher's cancellation test, loaded by `history.eval.ts` through
 * `APPLE_PI_EVAL_SESSIONS_MODULE`. Every model request is held open until aborted. Markers in
 * `EVAL_FIXTURE_MARKERS`: `cwds` lists each session's directory, `requested` appears at the first request,
 * and `closed` when the evaluation closes the sessions.
 */
export async function openSessions(
	_model: string,
): Promise<{ createSession: SessionFactory; modelLabel: string; close: () => void }> {
	const markers = process.env.EVAL_FIXTURE_MARKERS;
	if (!markers) throw new Error("Set EVAL_FIXTURE_MARKERS.");
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

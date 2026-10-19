import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { afterAll, expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import registerSessionTitle from "../../session-title/src/index.js";
import bridge from "../src/index.js";
import { close, query, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
afterAll(() => stopRuntime(state));

const isIntent = (context: Context) => {
	const first = context.messages[0];
	return typeof first?.content === "string" && first.content.includes("is working on now");
};

test("the session's stated intent is a fact with its own change events, unchanged when the work is the same", async () => {
	writeFileSync(
		join(state.agentDir, "model-profiles.json"),
		JSON.stringify({ profiles: { quick: { model: "faux-session-provider/faux-session-model", thinking: "off" } } }),
	);
	const intents = ["Fixing the CSV parser crash", "KEEP"];
	const run = await fauxSession(
		[bridge, registerSessionTitle],
		(context) => fauxAssistantMessage(isIntent(context) ? (intents.shift() ?? "KEEP") : "Done."),
		[],
	);
	try {
		await run.session.bindExtensions({ mode: "tui", uiContext: { notify: () => {} } as never });
		const id = run.session.sessionManager.getSessionId();
		const row = () => query<{ intent: string | null }>(state.dbPath, "select intent from sessions where id = ?", id)[0];
		const changes = () =>
			query<{ data: string }>(
				state.dbPath,
				"select data from events where session_id = ? and type = 'intent_changed'",
				id,
			);
		await vi.waitFor(() => expect(row()).toBeDefined(), { timeout: 15000 });

		await run.session.prompt("The CSV parser crashes on quoted commas.");
		await vi.waitFor(() => expect(row()?.intent).toBe("Fixing the CSV parser crash"), { timeout: 5000 });
		expect(changes()).toHaveLength(1);

		await run.session.prompt("Add a test for it.");
		await vi.waitFor(() => expect(intents).toEqual([]));
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(row()?.intent).toBe("Fixing the CSV parser crash");
		expect(changes()).toHaveLength(1);

		// A reload's new bridge knows no intent yet; the recorded one stays.
		await run.session.bindExtensions({});
		await new Promise((resolve) => setTimeout(resolve, 500));
		expect(row()?.intent).toBe("Fixing the CSV parser crash");
	} finally {
		await close(run);
	}
}, 30000);

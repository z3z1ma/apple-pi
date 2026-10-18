import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxModelBackend } from "../../../tests/helpers/faux-model.js";
import { runAgent } from "../../subagents/src/agent-runner.js";
import { registerAgents } from "../../subagents/src/agent-types.js";
import { disposeAgentSession } from "../../subagents/src/session-lifecycle.js";
import type { AgentConfig } from "../../subagents/src/types.js";
import { query, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
const cwd = mkdtempSync(join(tmpdir(), "aps-sub-"));
writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
// A runtime is normally running already; starting it first keeps the child's first events from racing its start.
beforeAll(() => startRuntime(state.socketPath));
afterAll(async () => {
	await stopRuntime(state);
	rmSync(cwd, { recursive: true, force: true });
});

type Row = Record<string, unknown>;

test("a subagent appears as a child of the session that started it, with its own activity, and ends when stopped", async () => {
	const faux = registerFauxProvider({ provider: "faux", models: [{ id: "faux-child", contextWindow: 200_000 }] });
	try {
		faux.setResponses([
			() => fauxAssistantMessage([fauxToolCall("read", { path: "app.ts" })], { stopReason: "toolUse" }),
			() => fauxAssistantMessage([fauxText("CHILD-OK")]),
		]);
		const model = faux.getModel();
		const runtime = fauxModelBackend(model);
		registerAgents(
			new Map<string, AgentConfig>([
				[
					"reader",
					{
						name: "reader",
						description: "reads",
						builtinToolNames: ["read"],
						extensions: false,
						skills: false,
						persistSession: false,
						systemPrompt: "Read the file.",
						promptMode: "replace",
					},
				],
			]),
		);
		const parent = {
			cwd,
			model,
			modelRegistry: runtime.modelRegistry,
			getSystemPrompt: () => "parent",
			sessionManager: { getSessionFile: () => undefined, getSessionId: () => "parent-session-1" },
		};
		const result = await runAgent(parent as never, "reader", "read app.ts", {
			pi: { exec: async () => ({ code: 1, stdout: "", stderr: "" }) } as never,
			model,
		});
		expect(result.responseText).toBe("CHILD-OK");
		const childId = result.session.sessionManager.getSessionId();
		await vi.waitFor(
			() =>
				expect(query<Row>(state.dbPath, "select kind, spawned_by from sessions where id = ?", childId)).toEqual([
					{ kind: "child", spawned_by: "parent-session-1" },
				]),
			{ timeout: 15000 },
		);
		const [incarnation] = query<Row>(
			state.dbPath,
			"select pid, process_state, pane_id from incarnations where session_id = ?",
			childId,
		);
		expect(incarnation).toEqual({ pid: process.pid, process_state: "alive", pane_id: null });
		await vi.waitFor(() =>
			expect(
				query(
					state.dbPath,
					"select json_extract(data, '$.name') as name from events where session_id = ? and type = 'tool_started'",
					childId,
				),
			).toEqual([{ name: "read" }]),
		);
		await disposeAgentSession(result.session);
		await vi.waitFor(() =>
			expect(
				query<Row>(state.dbPath, "select process_state, end_reason from incarnations where session_id = ?", childId),
			).toEqual([{ process_state: "exited", end_reason: "quit" }]),
		);
	} finally {
		faux.unregister();
	}
}, 30000);

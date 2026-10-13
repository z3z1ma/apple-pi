import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import piExec from "../extensions/pi-exec.js";
import { fauxSession } from "./helpers/faux-session.js";

const sessions: Array<{ dispose(): void }> = [];
afterEach(() => {
	for (const session of sessions.splice(0)) session.dispose();
});

const usage = {
	input: 7,
	output: 5,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 12,
	cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
};

describe("pi_exec nested tool usage", () => {
	it("is counted once, on the pi_exec result, by Pi's nested-call pipeline", async () => {
		const faux = await fauxSession(
			[
				piExec,
				(pi) => {
					pi.registerTool({
						name: "priced",
						label: "Priced",
						description: "A tool that reports model usage",
						parameters: Type.Object({}),
						async execute() {
							return { content: [{ type: "text", text: "priced" }], details: undefined, usage };
						},
					});
				},
			],
			[
				fauxAssistantMessage(
					fauxToolCall(
						"pi_exec",
						{ code: 'first = await priced()\nsecond = await priced()\n[first["text"], second["text"]]' },
						{ id: "exec-1" },
					),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("done"),
			],
			["pi_exec", "priced"],
		);
		sessions.push(faux);

		await faux.session.prompt("run it");

		const result = faux.session.messages.find(
			(message) => message.role === "toolResult" && message.toolCallId === "exec-1",
		) as { isError: boolean; usage?: typeof usage; nestedCalls?: { calls: unknown[] } } | undefined;
		expect(result?.isError).toBe(false);
		expect(result?.nestedCalls?.calls).toHaveLength(2);
		expect(result?.usage).toMatchObject({ input: 14, output: 10, totalTokens: 24, cost: { total: 0.6 } });
	}, 30_000);
});

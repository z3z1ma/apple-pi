import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { expect, it } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { registerRecallTool } from "../src/tool.js";
import { startRecallRuntime } from "./indexed-runtime.js";

it.each([false, true])(
	"excludes the issuing parent through native nested execution (delegated: %s)",
	async (delegated) => {
		const cwd = mkdtempSync(join(tmpdir(), "nested-recall-"));
		const sessionManager = SessionManager.create(cwd, join(cwd, "sessions"));
		const historicalEntryId = sessionManager.appendMessage({
			role: "user",
			content: "historicalneedle retained evidence",
			timestamp: 0,
		});
		let runtime: Awaited<ReturnType<typeof startRecallRuntime>> | undefined;
		const runner = await fauxSession(
			[
				(pi) => {
					registerRecallTool(pi);
					pi.registerTool({
						name: "delegate",
						label: "Delegate",
						description: "Invoke session recall",
						parameters: Type.Object({ query: Type.String() }),
						async execute(_id, args, _signal, _update, ctx) {
							const outcome = await ctx.executeTool("search_session", args);
							if (outcome.isError) throw new Error("Nested search failed");
							return outcome.result;
						},
					});
					pi.registerTool({
						name: "compose",
						label: "Compose",
						description: "Run a composed recall request",
						parameters: Type.Object({ query: Type.String() }),
						async execute(_id, args, _signal, _update, ctx) {
							runtime ??= await startRecallRuntime(
								ctx.sessionManager.getSessionFile()!,
								ctx.sessionManager.getEntries(),
								ctx.sessionManager.getSessionId(),
								false,
							);
							const outcome = await ctx.executeTool(delegated ? "delegate" : "search_session", args);
							if (outcome.isError) throw new Error("Composed search failed");
							return outcome.result;
						},
					});
				},
			],
			[
				fauxAssistantMessage(fauxToolCall("compose", { query: "selfonlyneedle" }, { id: "outer" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage(fauxToolCall("compose", { query: "historicalneedle" }, { id: "historical" }), {
					stopReason: "toolUse",
				}),
				fauxAssistantMessage("Done"),
			],
			["compose", "delegate", "search_session"],
			{ cwd, sessionManager },
		);
		try {
			await runner.session.prompt("Proceed.");
			for (const [callId, expected] of [
				["outer", ["No matches"]],
				["historical", [`Read source: entry:${historicalEntryId}`, "historicalneedle retained evidence"]],
			] as const) {
				const output = runner.session.messages.find(
					(message) => message.role === "toolResult" && message.toolCallId === callId,
				);
				if (output?.role !== "toolResult") throw new Error(`Missing ${callId} tool result`);
				expect(output.isError).toBe(false);
				const text = output.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join("\n");
				for (const passage of expected) expect(text).toContain(passage);
			}
		} finally {
			runner.dispose();
			await runtime?.stop();
			rmSync(cwd, { recursive: true, force: true });
		}
	},
);

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { expect, it } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { registerRecallTool } from "../src/tool.js";

it.each([false, true])(
	"excludes the issuing parent through native nested execution (delegated: %s)",
	async (delegated) => {
		const cwd = mkdtempSync(join(tmpdir(), "nested-recall-"));
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
				fauxAssistantMessage("Done"),
			],
			["compose", "delegate", "search_session"],
			{ cwd, sessionManager: SessionManager.create(cwd, join(cwd, "sessions")) },
		);
		try {
			await runner.session.prompt("Proceed.");
			const output = runner.session.messages.find(
				(message) => message.role === "toolResult" && message.toolCallId === "outer",
			);
			expect(output?.role).toBe("toolResult");
			if (output?.role !== "toolResult") throw new Error("Missing outer tool result");
			expect(output.isError).toBe(false);
			expect(
				output.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join("\n"),
			).toContain("No matches");
		} finally {
			runner.dispose();
			rmSync(cwd, { recursive: true, force: true });
		}
	},
);

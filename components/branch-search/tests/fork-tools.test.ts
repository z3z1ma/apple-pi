import { Type } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { expect, it } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import { startFork } from "../../shared/src/forked-continuation.js";
import { SEARCH_BLOCKED_TOOLS } from "../src/orchestrator.js";

it("keeps a search attempt from starting colleagues, contacting people, or consuming their threads", async () => {
	const names = ["hire", "send_mail", "explore", "read_thread"];
	const executed: string[] = [];
	const parent = await fauxSession(
		[
			(pi) => {
				for (const name of names)
					pi.registerTool({
						name,
						label: name,
						description: name,
						parameters: Type.Object({}),
						async execute() {
							executed.push(name);
							return { content: [{ type: "text", text: "External action happened" }], details: {} };
						},
					});
			},
		],
		[
			fauxAssistantMessage("Parent ready"),
			{
				...fauxAssistantMessage(""),
				content: names.map((name) => ({ type: "toolCall" as const, id: name, name, arguments: {} })),
				stopReason: "toolUse" as const,
			},
			fauxAssistantMessage("Attempt complete"),
		],
		names,
	);
	try {
		await parent.session.prompt("Parent work");
		const fork = startFork(parent.session, {
			messages: parent.session.messages,
			append: { role: "user", content: "Try the candidate", timestamp: Date.now() },
			label: "branch-search",
			blockedTools: SEARCH_BLOCKED_TOOLS,
		});
		const { messages } = await fork.result;
		const results = messages.filter((message) => message.role === "toolResult");
		expect(results).toHaveLength(names.length);
		for (const result of results) {
			expect(result.isError).toBe(true);
			expect(JSON.stringify(result.content)).toContain("not available in this fork");
		}
		expect(executed).toEqual([]);
	} finally {
		parent.dispose();
	}
});

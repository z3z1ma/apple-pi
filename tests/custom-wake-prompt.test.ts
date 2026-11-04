import { getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { setSystemPromptSection } from "../components/shared/src/system-prompt-section.js";
import installSystemPrompt from "../extensions/system-prompt.js";
import { fauxSession } from "./helpers/faux-session.js";

const sessions: Array<{ dispose(): void }> = [];
afterEach(() => {
	for (const session of sessions.splice(0)) session.dispose();
});

describe("runs started by a custom message", () => {
	it("keep package prompt sections on their first and later provider requests", async () => {
		let api: ExtensionAPI | undefined;
		const starts: string[] = [];
		const faux = await fauxSession(
			[
				(pi) => {
					api = pi;
					pi.on("before_agent_start", (event) => {
						starts.push(event.messageType);
						setSystemPromptSection(event.systemPromptOptions, "probe", "Probe section.");
					});
				},
				installSystemPrompt,
			],
			[
				fauxAssistantMessage(fauxToolCall("read", { path: "app.ts" }, { id: "read-1" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("Reviewed the task result."),
			],
			["read"],
		);
		sessions.push(faux);

		api!.sendMessage(
			{ customType: "task-notification", content: "Task build finished", display: true },
			{
				triggerTurn: true,
			},
		);
		await expect.poll(() => faux.requests.length).toBe(2);
		await faux.session.agent.waitForIdle();

		expect(starts).toEqual(["custom"]);
		const marker = "<probe>";
		for (const request of faux.requests) expect(getCurrentSystemPrompt(request.messages as never)).toContain(marker);
	}, 30_000);
});

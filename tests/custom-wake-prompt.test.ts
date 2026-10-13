import { getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { LEDGER_SYSTEM_PROMPT_TAG } from "../components/shared/src/ledger-system-prompt.js";
import installLedger from "../extensions/ledger.js";
import { fauxSession } from "./helpers/faux-session.js";

const sessions: Array<{ dispose(): void }> = [];
afterEach(() => {
	for (const session of sessions.splice(0)) session.dispose();
});

/**
 * Task notifications, schedules, monitors, and pair findings start runs with a triggered custom
 * message. Those runs must carry the package's prompt sections on every provider request, or the
 * prompt changes mid-run and the provider's prefix cache breaks.
 */
describe("runs started by a custom message", () => {
	it("keep package prompt sections on their first and later provider requests", async () => {
		let api: ExtensionAPI | undefined;
		const starts: string[] = [];
		const faux = await fauxSession(
			[
				installLedger,
				(pi) => {
					api = pi;
					pi.on("before_agent_start", (event) => {
						starts.push(event.messageType);
					});
				},
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
		const marker = `<${LEDGER_SYSTEM_PROMPT_TAG}>`;
		for (const request of faux.requests) expect(getCurrentSystemPrompt(request.messages as never)).toContain(marker);
	}, 30_000);
});

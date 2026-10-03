import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import {
	LEARNING_REFLECTION_MESSAGE_TYPE,
	LEARNING_REFLECTION_SPACING_TOKENS,
	registerLearningReflection,
} from "../src/hooks/learning-reflection.js";

function captureExtension() {
	const handlers = new Map<string, (event: unknown) => unknown>();
	const commands = new Map<string, { handler: () => Promise<void> }>();
	const sent: Array<{ message: { content: string }; options: unknown }> = [];
	const pi = {
		on: (event: string, handler: (event: unknown) => unknown) => handlers.set(event, handler),
		registerCommand: (name: string, command: { handler: () => Promise<void> }) => commands.set(name, command),
		sendMessage: (message: { content: string }, options: unknown) => sent.push({ message, options }),
	} as unknown as ExtensionAPI;
	registerLearningReflection(pi);
	const emit = (event: string, payload: unknown) => handlers.get(event)?.(payload);
	const spend = (tokens: number) =>
		emit("message_end", { message: { role: "assistant", usage: { input: tokens, cacheWrite: 0, output: 0 } } });
	const run = (command: string, isError: boolean, expect?: "success" | "failure", surprise?: boolean) =>
		emit("tool_result", { isError, toolName: "bash", input: { command, expect }, details: { surprise } });
	const fail = (command: string) => run(command, true);
	const settle = () =>
		emit("agent_before_settle", { outcome: "completed" }) as
			| { entries: Array<{ customType: string; content: string }>; continue: boolean }
			| undefined;
	return { commands, sent, spend, run, fail, settle };
}

describe("learning reflection", () => {
	it("waits for enough new tokens, then asks once with the failed calls as evidence", () => {
		const { spend, fail, settle } = captureExtension();
		fail("aws s3 ls\n--profile dev");
		fail("aws s3 ls\n--profile dev");
		spend(LEARNING_REFLECTION_SPACING_TOKENS - 1);
		expect(settle()).toBeUndefined();

		spend(1);
		const result = settle();
		expect(result?.continue).toBe(true);
		expect(result?.entries[0]?.customType).toBe(LEARNING_REFLECTION_MESSAGE_TYPE);
		expect(result?.entries[0]?.content).toContain(
			"Failed or surprising tool calls since the last reflection:\n- bash: `aws s3 ls`",
		);
		expect(result?.entries[0]?.content.match(/aws s3 ls/g)).toHaveLength(1);

		expect(settle()).toBeUndefined();
	});

	it("asks on demand with /reflect and restarts the spacing", async () => {
		const { commands, sent, spend, settle } = captureExtension();
		spend(LEARNING_REFLECTION_SPACING_TOKENS);
		await commands.get("reflect")?.handler();
		expect(sent[0]?.message.content).toContain("Reflect on what you learned");
		expect(sent[0]?.message.content).not.toContain("Failed or surprising");
		expect(sent[0]?.options).toEqual({ deliverAs: "steer", triggerTurn: true });
		expect(settle()).toBeUndefined();
	});

	it("drops predicted failures and keeps unpredicted successes as evidence", () => {
		const { spend, run, settle } = captureExtension();
		run("npm test -- red", true, "failure");
		run("npm test -- green", false, "failure", true);
		run("npm run watch", false, "failure");
		run("npm run build", true, "success");
		spend(LEARNING_REFLECTION_SPACING_TOKENS);
		const content = settle()?.entries[0]?.content ?? "";
		expect(content).not.toContain("-- red");
		expect(content).toContain("- bash: `npm test -- green` succeeded; you predicted failure");
		expect(content).toContain("- bash: `npm run build`");
		expect(content).not.toContain("watch");
	});
});

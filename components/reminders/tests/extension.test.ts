import { describe, expect, it, vi } from "vitest";
import { runInChildSessionContext } from "../../subagents/src/child-context.js";
import { installReminders } from "../src/index.js";

describe("remind_me extension", () => {
	it("delivers one cleared queue as a visible follow-up after the run settles", async () => {
		const tools: any[] = [];
		const handlers = new Map<string, (...args: any[]) => unknown>();
		const sendMessage = vi.fn();
		installReminders({
			on: (event: string, handler: (...args: any[]) => unknown) => handlers.set(event, handler),
			registerTool: (tool: any) => tools.push(tool),
			sendMessage,
		} as any);

		expect(tools.map((tool) => tool.name)).toEqual(["remind_me"]);
		await tools[0].execute("one", { message: "Run the focused test." });
		await handlers.get("turn_end")?.({}, {});
		await tools[0].execute("two", { message: "Then inspect the diff." });
		expect(sendMessage).not.toHaveBeenCalled();
		await handlers.get("agent_settled")?.({}, {});

		expect(sendMessage).toHaveBeenCalledTimes(1);
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				display: true,
				content: expect.stringContaining("Run the focused test.\n- Then inspect the diff."),
			}),
			{ deliverAs: "followUp", triggerTurn: true },
		);
		const content = sendMessage.mock.calls[0][0].content;
		expect(content).toMatch(/own deferred notes/i);
		expect(content).toMatch(/not new operator authority/i);
		expect(content).toMatch(/latest direction and repository state/i);

		await handlers.get("agent_settled")?.({}, {});
		expect(sendMessage).toHaveBeenCalledTimes(1);
	});

	it("does not register in a child session", () => {
		const registerTool = vi.fn();
		const on = vi.fn();
		runInChildSessionContext(() => installReminders({ registerTool, on } as any));
		expect(registerTool).not.toHaveBeenCalled();
		expect(on).not.toHaveBeenCalled();
	});

	it("clears undelivered reminders on session lifecycle changes", async () => {
		const tools: any[] = [];
		const handlers = new Map<string, (...args: any[]) => unknown>();
		const sendMessage = vi.fn();
		installReminders({
			on: (event: string, handler: (...args: any[]) => unknown) => handlers.set(event, handler),
			registerTool: (tool: any) => tools.push(tool),
			sendMessage,
		} as any);

		for (const event of [
			"session_start",
			"session_before_fork",
			"session_before_tree",
			"session_tree",
			"session_before_switch",
			"session_shutdown",
		]) {
			await tools[0].execute("call", { message: event });
			await handlers.get(event)?.({}, {});
			await handlers.get("agent_settled")?.({}, {});
		}
		expect(sendMessage).not.toHaveBeenCalled();
	});
});

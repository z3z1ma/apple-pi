import { copyToClipboard } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { registerBtwCommand } from "../src/btw.js";
import type { AgentRecord } from "../src/types.js";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
	...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
	copyToClipboard: vi.fn(),
}));

function theme() {
	return {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	};
}

function session(messages: any[]) {
	return {
		messages,
		state: {},
		subscribe: vi.fn(() => vi.fn()),
		getSessionStats: () => ({ tokens: { input: 0, output: 0, cacheWrite: 0 } }),
	};
}

function record(id: string, messages: any[]): AgentRecord {
	return {
		id,
		type: "BTW",
		description: "BTW side conversation",
		status: "completed",
		toolUses: 0,
		startedAt: Date.now(),
		completedAt: Date.now(),
		lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
		compactionCount: 0,
		session: session(messages) as any,
		internalOwner: "apple-pi:btw",
	};
}

async function enterQuestion(viewer: { handleInput(data: string): void }, question: string) {
	viewer.handleInput("\r");
	for (const character of question) viewer.handleInput(character);
	viewer.handleInput("\r");
	await vi.waitFor(() => expect(viewer).toBeDefined());
}

describe("BTW command", () => {
	it("refreshes parent context once per overlay visit while preserving an append-only child prefix", async () => {
		const commands = new Map<string, any>();
		const shortcuts = new Map<string, any>();
		const events = new Map<string, Array<(...args: any[]) => void>>();
		const records = new Map<string, AgentRecord>();
		const prompts: string[] = [];
		const sendUserMessage = vi.fn();
		let viewer: any;
		let spawnOptions: any;
		let branch: any[] = [
			{ id: "1", type: "message", message: { role: "user", content: "Implement the parser" } },
			{
				id: "2",
				type: "message",
				message: { role: "assistant", content: [{ type: "text", text: "I am tracing it." }] },
			},
		];

		const pi = {
			on: vi.fn((name: string, handler: (...args: any[]) => void) => {
				const handlers = events.get(name) ?? [];
				handlers.push(handler);
				events.set(name, handlers);
			}),
			registerCommand: vi.fn((name: string, command: any) => commands.set(name, command)),
			registerShortcut: vi.fn((name: string, shortcut: any) => shortcuts.set(name, shortcut)),
			sendUserMessage,
		};
		const manager = {
			spawn: vi.fn((_pi, _ctx, _type, prompt: string, options: any) => {
				prompts.push(prompt);
				spawnOptions = options;
				const next = record("btw-1", [
					{ role: "user", content: prompt },
					{ role: "assistant", content: [{ type: "text", text: "The parser is recursive." }], stopReason: "stop" },
				]);
				records.set(next.id, next);
				return next.id;
			}),
			getRecord: vi.fn((id: string) => records.get(id)),
			resume: vi.fn(async (id: string, prompt: string) => {
				prompts.push(prompt);
				const current = records.get(id)!;
				(current.session!.messages as any[]).push({ role: "user", content: prompt });
				current.status = "completed";
				return current;
			}),
			steer: vi.fn(),
			abort: vi.fn(),
			discardInternal: vi.fn(() => true),
		};
		const ctx = {
			hasUI: true,
			mode: "tui",
			model: { provider: "test", id: "model" },
			thinkingLevel: "medium",
			isIdle: () => false,
			sessionManager: { getBranch: () => branch },
			ui: {
				notify: vi.fn(),
				input: vi.fn(),
				custom: vi.fn(async (factory: any) => {
					viewer = factory(
						{ terminal: { rows: 40, columns: 100 }, requestRender: vi.fn() },
						theme(),
						undefined,
						vi.fn(),
					);
				}),
			},
		};

		registerBtwCommand(pi as any, manager as any);
		await commands.get("btw").handler("Why is it recursive?", ctx);
		expect(prompts[0]).toContain("Implement the parser");
		expect(prompts[0]).toContain("Why is it recursive?");
		expect(spawnOptions).toMatchObject({
			agentConfig: {
				extensions: false,
				skills: false,
				pair: false,
				persistSession: false,
			},
			loadStandardChildExtensions: false,
			pair: false,
			isolated: true,
			inheritContext: false,
			invocation: {
				modelName: "test/model",
				thinking: "medium",
				isolated: true,
				pair: false,
			},
		});

		branch = [
			...branch,
			{
				id: "3",
				type: "message",
				message: { role: "assistant", content: [{ type: "text", text: "I found the base case." }] },
			},
		];
		await commands.get("btw").handler("", ctx);
		await enterQuestion(viewer, "Does that base case terminate?");
		expect(prompts[1]).toContain("I found the base case.");
		expect(prompts[1]).not.toContain("Implement the parser");
		expect(prompts[1]).toContain("Does that base case terminate?");

		branch = [
			...branch,
			{ id: "4", type: "message", message: { role: "assistant", content: [{ type: "text", text: "New root work" }] } },
		];
		await enterQuestion(viewer, "Stay with the captured snapshot");
		expect(prompts[2]).toBe("Stay with the captured snapshot");

		await commands.get("btw").handler("", ctx);
		await enterQuestion(viewer, "What changed in the main thread?");
		expect(prompts[3]).toContain("New root work");
		expect(prompts[3]).not.toContain("Implement the parser");

		await shortcuts.get("alt+i").handler(ctx);
		expect(sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("The parser is recursive."), {
			deliverAs: "followUp",
		});

		viewer.handleInput("\x18");
		await vi.waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith("The parser is recursive."));
		expect(ctx.ui.notify).toHaveBeenCalledWith("Copied the latest BTW answer to the clipboard.", "info");
	});
});

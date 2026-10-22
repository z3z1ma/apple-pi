import { copyToClipboard } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { formatBtwUserMessage } from "../src/context.js";
import { install } from "../src/index.js";
import { type BtwConversation, createBtwConversation } from "../src/session.js";
import { BTW_VIEWPORT_HEIGHT_PCT, type BtwViewer } from "../src/ui/viewer.js";

vi.mock("@earendil-works/pi-coding-agent", async (original) => ({
	...(await original<typeof import("@earendil-works/pi-coding-agent")>()),
	copyToClipboard: vi.fn(),
}));
vi.mock("../src/session.js", async (original) => ({
	...(await original<typeof import("../src/session.js")>()),
	createBtwConversation: vi.fn(),
}));

function setup() {
	const commands = new Map<string, any>();
	const shortcuts = new Map<string, any>();
	const events = new Map<string, (...args: any[]) => Promise<void>>();
	const prompts: string[] = [];
	const messages: any[] = [];
	const conversation = {
		session: { messages, state: {}, getContextUsage: () => undefined },
		status: "completed",
		startedAt: Date.now(),
		completedAt: Date.now(),
		toolUses: 0,
		compactionCount: 0,
		lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
		invocation: { modelName: "test/model", thinking: "medium" },
		activity: "thinking",
		subscribe: vi.fn(() => vi.fn()),
		stop: vi.fn(),
		close: vi.fn(async () => {}),
		submit: vi.fn(async (prompt: string) => {
			prompts.push(prompt);
			messages.push(
				{ role: "user", content: prompt },
				{ role: "assistant", content: [{ type: "text", text: "The parser is recursive." }], stopReason: "stop" },
			);
			return true;
		}),
	};
	vi.mocked(createBtwConversation)
		.mockReset()
		.mockResolvedValue(conversation as unknown as BtwConversation);
	let viewer!: BtwViewer;
	let branch: any[] = [
		{ id: "1", type: "message", message: { role: "user", content: "Implement the parser" } },
		{ id: "2", type: "message", message: { role: "assistant", content: [{ type: "text", text: "I am tracing it." }] } },
	];
	const pi = {
		on: (name: string, handler: (...args: any[]) => Promise<void>) => events.set(name, handler),
		registerCommand: (name: string, command: any) => commands.set(name, command),
		registerShortcut: (name: string, shortcut: any) => shortcuts.set(name, shortcut),
		sendUserMessage: vi.fn(),
	};
	const ctx = {
		hasUI: true,
		mode: "tui",
		isIdle: () => false,
		sessionManager: { getBranch: () => branch },
		ui: {
			notify: vi.fn(),
			input: vi.fn(),
			custom: vi.fn(async (factory: any) => {
				viewer = factory(
					{ terminal: { rows: 40, columns: 100 }, requestRender: vi.fn() },
					{ fg: (_: string, text: string) => text, bold: (text: string) => text },
					undefined,
					vi.fn(),
				);
			}),
		},
	};
	install(pi as any);
	return {
		pi,
		ctx,
		conversation,
		prompts,
		events,
		command: (text: string) => commands.get("btw").handler(text, ctx),
		shortcut: (name: string) => shortcuts.get(name).handler(ctx),
		append: (text: string) => {
			branch = [
				...branch,
				{
					id: String(branch.length + 1),
					type: "message",
					message: { role: "assistant", content: [{ type: "text", text }] },
				},
			];
		},
		get viewer() {
			return viewer;
		},
		async question(text: string) {
			const count = prompts.length;
			viewer.handleInput("\r");
			for (const ch of text) viewer.handleInput(ch);
			viewer.handleInput("\r");
			await vi.waitFor(() => expect(prompts).toHaveLength(count + 1));
		},
	};
}

it("refreshes parent context once per visit, preserves the conversation, and keeps copy/inject explicit", async () => {
	const h = setup();
	await h.command("Why is it recursive?");
	expect(h.ctx.ui.custom).toHaveBeenCalledWith(expect.any(Function), {
		overlay: true,
		overlayOptions: { anchor: "top-center", width: "90%", maxHeight: `${BTW_VIEWPORT_HEIGHT_PCT}%` },
	});
	expect(h.prompts[0]).toContain("Implement the parser");
	h.append("I found the base case.");
	await h.command("");
	await h.question("Does that terminate?");
	expect(h.prompts[1]).toContain("I found the base case.");
	expect(h.prompts[1]).not.toContain("Implement the parser");
	h.append("New root work");
	await h.question("Stay with the captured snapshot");
	expect(formatBtwUserMessage(h.prompts[2])).toBe("Stay with the captured snapshot");
	expect(h.prompts[2]).not.toContain("New root work");
	await h.command("");
	await h.question("What changed?");
	expect(h.prompts[3]).toContain("New root work");
	expect(createBtwConversation).toHaveBeenCalledTimes(1);
	expect(h.conversation.close).not.toHaveBeenCalled();
	expect(h.pi.sendUserMessage).not.toHaveBeenCalled();
	await h.shortcut("alt+i");
	expect(h.pi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("The parser is recursive."), {
		deliverAs: "followUp",
	});
	h.viewer.handleInput("\x18");
	await vi.waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith("The parser is recursive."));
	await h.shortcut("alt+x");
	expect(h.conversation.close).toHaveBeenCalledTimes(1);
	await h.command("Start over");
	expect(createBtwConversation).toHaveBeenCalledTimes(2);
	expect(h.prompts.at(-1)).toContain("Implement the parser");
});

it("keeps the parent snapshot for retry when the first question is rejected", async () => {
	const h = setup();
	h.conversation.submit.mockResolvedValueOnce(false);
	await h.command("Rejected question");
	expect(h.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("could not accept"), "error");
	expect(h.ctx.ui.custom).not.toHaveBeenCalled();
	await h.command("Retry the question");
	expect(h.prompts.at(-1)).toContain("Implement the parser");
});

it("closes a session whose creation finishes after navigation without opening its overlay", async () => {
	const h = setup();
	let created!: (conversation: BtwConversation) => void;
	vi.mocked(createBtwConversation).mockReturnValueOnce(
		new Promise((resolve) => {
			created = resolve;
		}),
	);
	const opening = h.command("A question");
	const reset = h.events.get("session_tree")!();
	created(h.conversation as unknown as BtwConversation);
	await Promise.all([opening, reset]);
	expect(h.conversation.close).toHaveBeenCalledTimes(1);
	expect(h.conversation.submit).not.toHaveBeenCalled();
	expect(h.ctx.ui.custom).not.toHaveBeenCalled();
});

it("awaits cleanup even when shutdown overlaps clearing the overlay", async () => {
	const h = setup();
	await h.command("A question");
	let release!: () => void;
	h.conversation.close.mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			}),
	);
	const clearing = h.shortcut("alt+x");
	let settled = false;
	const shutdown = h.events.get("session_shutdown")!().then(() => {
		settled = true;
	});
	await vi.waitFor(() => expect(h.conversation.close).toHaveBeenCalledOnce());
	expect(settled).toBe(false);
	release();
	await Promise.all([clearing, shutdown]);
	expect(settled).toBe(true);
});

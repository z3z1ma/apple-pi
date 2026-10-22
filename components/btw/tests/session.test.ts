import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import { buildBtwPrompt } from "../src/context.js";
import { type BtwConversation, createBtwConversation } from "../src/session.js";

afterEach(() => vi.unstubAllEnvs());

async function setup(replies: Parameters<typeof fauxSession>[1]) {
	let context!: ExtensionContext;
	const parent = await fauxSession(
		[
			(pi) => {
				pi.on("before_agent_start", (_event, ctx) => {
					context = ctx;
				});
			},
		],
		replies,
		[],
	);
	vi.stubEnv("PI_CODING_AGENT_DIR", join(parent.cwd, "agent"));
	await parent.session.setModel({ ...parent.session.model!, reasoning: true });
	parent.session.setThinkingLevel("medium");
	await parent.session.prompt("Parent work");
	let conversation: BtwConversation | undefined;
	try {
		conversation = await createBtwConversation(context);
	} catch (error) {
		parent.dispose();
		throw error;
	}
	return {
		parent,
		conversation,
		async dispose() {
			await conversation.close();
			parent.dispose();
		},
	};
}

it("owns one private read-only session using the parent's selected mind", async () => {
	const read = {
		...fauxAssistantMessage(""),
		content: [{ type: "toolCall" as const, id: "read-app", name: "read", arguments: { path: "app.ts" } }],
		stopReason: "toolUse" as const,
	};
	const h = await setup([
		fauxAssistantMessage("Parent answer"),
		read,
		fauxAssistantMessage("The value is one."),
		fauxAssistantMessage("Parent still works"),
	]);
	try {
		const { conversation: c, parent } = h;
		expect(c.session.model).toEqual(parent.session.model);
		expect(c.session.thinkingLevel).toBe("medium");
		expect(c.session.sessionFile).toBeUndefined();
		expect(c.session.getActiveToolNames().sort()).toEqual(["find", "grep", "ls", "read"]);
		expect(c.session.resourceLoader.getSkills().skills).toEqual([]);
		expect(c.session.resourceLoader.getAgentsFiles().agentsFiles).toEqual([]);
		expect(await c.submit(buildBtwPrompt("Parent context", "Read app.ts"))).toBe(true);
		await vi.waitFor(() => expect(c.status).toBe("completed"));
		expect(c.session.messages.find((message) => message.role === "toolResult")).toMatchObject({
			isError: false,
			content: [{ type: "text", text: expect.stringContaining("export const value = 1") }],
		});
		expect(c.toolUses).toBe(1);
		expect(parent.session.messages.some((message) => JSON.stringify(message).includes("The value is one."))).toBe(
			false,
		);
		const prompt = parent.requests
			.at(-1)!
			.messages.map((message) => JSON.stringify(message))
			.join("\n");
		expect(prompt).toContain("read-only repository tools");
		expect(prompt).toContain('"name":"read"');
		expect(prompt).not.toContain("<subagent-team>");
		expect(prompt).not.toContain("<org>");
		await c.close();
		await parent.session.prompt("Continue parent work");
		expect(parent.session.messages.at(-1)).toMatchObject({
			role: "assistant",
			content: [{ type: "text", text: "Parent still works" }],
		});
	} finally {
		await h.dispose();
	}
});

it("queues follow-ups in the same conversation, then aborts and disposes it once", async () => {
	let release!: (reply: Reply) => void;
	const held = new Promise<Reply>((resolve) => {
		release = resolve;
	});
	const h = await setup((context) => {
		const user = context.messages.filter((message) => message.role === "user").at(-1);
		const text = JSON.stringify(user);
		if (text.includes("hold first")) return held;
		if (text.includes("hold abort")) return "until-aborted";
		return fauxAssistantMessage("Answer");
	});
	try {
		const c = h.conversation;
		const id = c.session.sessionId;
		await c.submit(buildBtwPrompt("", "hold first"));
		await vi.waitFor(() => expect(h.parent.requests).toHaveLength(2));
		await c.submit(buildBtwPrompt("", "/fast is a question, not a command"));
		release(fauxAssistantMessage("First answer"));
		await vi.waitFor(() => expect(c.status).toBe("completed"));
		expect(h.parent.requests).toHaveLength(3);
		expect(c.session.sessionId).toBe(id);
		expect(
			c.session.messages.some(
				(message) => message.role === "user" && JSON.stringify(message).includes("/fast is a question"),
			),
		).toBe(true);
		await c.submit(buildBtwPrompt("", "hold abort"));
		await vi.waitFor(() => expect(h.parent.requests).toHaveLength(4));
		const emit = vi.spyOn(c.session.extensionRunner, "emit");
		const dispose = vi.spyOn(c.session, "dispose");
		await Promise.all([c.close(), c.close()]);
		expect(c.status).toBe("aborted");
		expect(c.session.isStreaming).toBe(false);
		expect(emit.mock.calls.filter(([event]) => event.type === "session_shutdown")).toHaveLength(1);
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(await c.submit("Too late")).toBe(false);
	} finally {
		await h.dispose();
	}
});

it("can cancel automatic compaction before the next question is accepted", async () => {
	let hold = false;
	const h = await setup(() =>
		hold
			? "until-aborted"
			: {
					...fauxAssistantMessage("Enough prior conversation to compact."),
					usage: {
						input: 120,
						output: 30,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 150,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
				},
	);
	try {
		const c = h.conversation;
		await c.submit(buildBtwPrompt("", "First question"));
		await vi.waitFor(() => expect(c.status).toBe("completed"));
		c.session.settingsManager.applyOverrides({
			compaction: { enabled: true, reserveTokens: 99_999, keepRecentTokens: 1 },
		});
		hold = true;
		const opening = c.submit(buildBtwPrompt("", "Next question"));
		await vi.waitFor(() => expect(c.session.isCompacting).toBe(true));
		let closed = false;
		const closing = c.close().then(() => {
			closed = true;
		});
		await vi.waitFor(() => expect(closed).toBe(true));
		await Promise.all([opening, closing]);
		expect(c.status).toBe("aborted");
		expect(c.session.isStreaming).toBe(false);
		expect(c.session.isCompacting).toBe(false);
	} finally {
		await h.conversation.session.abort();
		await h.dispose();
	}
});

it("keeps SDK lifetime usage across compaction without a second accumulator", async () => {
	const reply = {
		...fauxAssistantMessage("An answer with enough context to compact."),
		usage: {
			input: 120,
			output: 30,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 150,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
	const h = await setup(() => reply);
	try {
		const c = h.conversation;
		for (const question of ["First question", "Second question"]) {
			await c.submit(buildBtwPrompt("", question));
			await vi.waitFor(() => expect(c.status).toBe("completed"));
		}
		const before = c.lifetimeUsage;
		c.session.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
		await c.session.compact();
		expect(c.compactionCount).toBe(1);
		expect(c.lifetimeUsage.input).toBeGreaterThanOrEqual(before.input);
		expect(c.lifetimeUsage.output).toBeGreaterThanOrEqual(before.output);
	} finally {
		await h.dispose();
	}
});

it("closes a prompt still preparing before the SDK starts its run", async () => {
	const h = await setup((context) =>
		JSON.stringify(context.messages.filter((message) => message.role === "user").at(-1)).includes("stall for cancel")
			? "until-aborted"
			: fauxAssistantMessage("Answer"),
	);
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	try {
		const c = h.conversation;
		const prompt = c.session.prompt.bind(c.session);
		vi.spyOn(c.session, "prompt").mockImplementation(async (...args) => {
			await gate;
			await prompt(...args);
		});
		const opening = c.submit(buildBtwPrompt("", "stall for cancel"));
		let closed = false;
		const closing = c.close().then(() => {
			closed = true;
		});
		await Promise.resolve();
		expect(closed).toBe(false);
		release();
		await vi.waitFor(() => expect(closed).toBe(true));
		await Promise.all([opening, closing]);
		expect(c.status).toBe("aborted");
		expect(c.session.isStreaming).toBe(false);
	} finally {
		release();
		await h.conversation.session.abort();
		await h.dispose();
	}
});

it("notifies the view when a preflight failure produces no session events", async () => {
	const h = await setup(() => fauxAssistantMessage("Answer"));
	try {
		const c = h.conversation;
		vi.spyOn(c.session, "prompt").mockRejectedValueOnce(new Error("Authentication failed"));
		const changes: string[] = [];
		const unsubscribe = c.subscribe(() => {
			changes.push(c.status);
		});
		expect(await c.submit(buildBtwPrompt("", "A question"))).toBe(false);
		await vi.waitFor(() => expect(c.status).toBe("error"));
		expect(c.error).toBe("Authentication failed");
		expect(changes).toEqual(["running", "error"]);
		unsubscribe();
	} finally {
		await h.dispose();
	}
});

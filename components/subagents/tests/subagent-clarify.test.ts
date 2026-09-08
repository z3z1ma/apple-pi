import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { type AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { fauxModelBackend } from "../../../tests/helpers/faux-model.js";
import { AgentManager } from "../src/agent-manager.js";
import * as runner from "../src/agent-runner.js";
import { captureClarifyContext, createClarifyTool } from "../src/clarify.js";
import type { AgentConfig } from "../src/types.js";

const agentDir = mkdtempSync(join(tmpdir(), "apple-pi-clarify-agent-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
	for (const fn of cleanup.splice(0).reverse()) await fn();
	vi.restoreAllMocks();
});
afterAll(() => {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(agentDir, { recursive: true, force: true });
});

const config: AgentConfig = {
	name: "clarify-test-child",
	description: "test",
	builtinToolNames: ["read"],
	extensions: false,
	skills: false,
	persistSession: false,
	promptMode: "replace",
	systemPrompt: "Do your assigned task.",
};

function setup() {
	const cwd = mkdtempSync(join(tmpdir(), "apple-pi-clarify-"));
	cleanup.push(() => rmSync(cwd, { recursive: true, force: true }));
	const faux = registerFauxProvider({
		provider: "faux",
		models: [
			{ id: "parent", contextWindow: 200_000, reasoning: true },
			{ id: "child", contextWindow: 200_000 },
		],
	});
	cleanup.push(() => faux.unregister());
	const model = faux.getModel("parent")!;
	const parent = {
		cwd,
		model,
		thinkingLevel: "high" as const,
		modelRegistry: fauxModelBackend(model).modelRegistry,
		sessionManager: SessionManager.inMemory(cwd),
		getSystemPrompt: () => "Parent instruction: respect the agreed scope.",
		isProjectTrusted: () => false,
		isIdle: vi.fn(() => false),
		abort: vi.fn(),
	} as any;
	const pi = { exec: vi.fn(async () => ({ code: 1, stdout: "", stderr: "" })) } as any;
	parent.sessionManager.appendMessage({ role: "user", content: "Original parent request", timestamp: 1 });
	return { cwd, faux, parent, pi };
}

function observeForks() {
	const original = runner.runAgent;
	const sessions: AgentSession[] = [];
	const disposals: ReturnType<typeof vi.spyOn>[] = [];
	vi.spyOn(runner, "runAgent").mockImplementation((ctx, type, prompt, options) =>
		original(ctx, type, prompt, {
			...options,
			onSessionCreated: (session) => {
				if (type === "parent-clarification") {
					sessions.push(session);
					disposals.push(vi.spyOn(session, "dispose"));
				}
				options.onSessionCreated?.(session);
			},
		}),
	);
	return { sessions, disposals };
}

describe("clarify parent snapshots", () => {
	it("copies the active compaction-aware branch, images, tool evidence, and pending-call placeholders", () => {
		const { parent } = setup();
		const sm: SessionManager = parent.sessionManager;
		const abandoned = sm.appendMessage({ role: "user", content: "abandoned branch", timestamp: 2 });
		sm.branch(sm.getEntry(abandoned)!.parentId!);
		const kept = sm.appendMessage({
			role: "user",
			content: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
			timestamp: 3,
		});
		sm.appendCompaction("Earlier decisions", kept, 1000);
		sm.appendMessage(
			fauxAssistantMessage(
				[
					fauxToolCall("read", { path: "done" }, { id: "read-done" }),
					fauxToolCall("agent", {}, { id: "agent-pending" }),
				],
				{ stopReason: "toolUse" },
			),
		);
		sm.appendMessage({
			role: "toolResult",
			toolCallId: "read-done",
			toolName: "read",
			content: [{ type: "text", text: "observed evidence" }],
			isError: false,
			timestamp: 4,
		});
		const before = structuredClone(sm.getEntries());
		const fork = captureClarifyContext(parent);
		const messages = fork.sessionManager.buildSessionContext().messages;
		expect(JSON.stringify(messages)).toContain("Earlier decisions");
		expect(JSON.stringify(messages)).not.toContain("abandoned branch");
		expect(JSON.stringify(messages)).not.toContain("Original parent request");
		expect(messages).toContainEqual(
			expect.objectContaining({ role: "user", content: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }] }),
		);
		expect(messages).toContainEqual(
			expect.objectContaining({ role: "toolResult", toolCallId: "read-done", isError: false }),
		);
		expect(messages.at(-1)).toMatchObject({ role: "toolResult", toolCallId: "agent-pending", isError: true });
		expect(JSON.stringify(messages.at(-1))).toContain("unavailable at clarification snapshot time");
		expect(fork.sessionManager.isPersisted()).toBe(false);
		messages.find((message) => message.role === "toolResult")!.content = [];
		expect(sm.getEntries()).toEqual(before);
		parent.getSystemPrompt = () => "changed later";
		expect(fork.getSystemPrompt()).toContain("respect the agreed scope");
	});
});

describe("clarify with real Pi sessions", () => {
	it("answers independently at pool capacity, uses fresh parent context/model, and returns usage to the child", async () => {
		const { cwd, faux, parent, pi } = setup();
		writeFileSync(join(cwd, "evidence.txt"), "verified locally");
		const { sessions, disposals } = observeForks();
		const manager = new AgentManager();
		manager.setMaxConcurrent(1);
		cleanup.push(() => manager.dispose());
		faux.setResponses([
			(context, _options, _state, model) => {
				expect(model.id).toBe("child");
				expect(context.tools?.map((tool) => tool.name)).toContain("clarify");
				expect(JSON.stringify(context.messages)).not.toContain("Original parent request");
				parent.sessionManager.appendMessage({
					role: "user",
					content: "Latest decision: keep it read-only",
					timestamp: 5,
				});
				return fauxAssistantMessage([fauxToolCall("clarify", { question: "What was decided? Check evidence.txt." })], {
					stopReason: "toolUse",
				});
			},
			(context, options, _state, model) => {
				expect(model.id).toBe("parent");
				expect(options?.reasoning).toBe("high");
				expect(
					context.tools?.map((tool) => tool.name).sort(),
					JSON.stringify(context.tools?.map((tool) => tool.name)),
				).toEqual(["find", "grep", "ls", "read"]);
				expect(context.systemPrompt).toContain("respect the agreed scope");
				expect(JSON.stringify(context.messages)).toContain("Latest decision: keep it read-only");
				return fauxAssistantMessage([fauxToolCall("read", { path: "evidence.txt" })], { stopReason: "toolUse" });
			},
			(context) => {
				expect(JSON.stringify(context.messages), JSON.stringify(context.messages)).toContain("verified locally");
				return fauxAssistantMessage([fauxText("Keep it read-only; evidence verified.")]);
			},
			(context) => {
				expect(JSON.stringify(context.messages)).toContain("Keep it read-only; evidence verified.");
				return fauxAssistantMessage([fauxText("CHILD-DONE")]);
			},
		]);
		const id = manager.spawn(pi, parent, config.name, "Perform your task", {
			description: "test",
			agentConfig: config,
			model: faux.getModel("child"),
			modelResolved: true,
			isBackground: true,
			isolated: true,
			enableClarify: true,
			loadStandardChildExtensions: false,
		});
		const record = manager.getRecord(id)!;
		await record.promise;
		expect(record.error).toBeUndefined();
		expect(record.status).toBe("completed");
		expect(record.result).toBe("CHILD-DONE");
		expect(sessions).toHaveLength(1);
		expect(sessions[0].sessionFile).toBeUndefined();
		expect(disposals[0]).toHaveBeenCalledTimes(1);
		const result = record.session!.messages.find(
			(message) => message.role === "toolResult" && message.toolName === "clarify",
		);
		expect(result).toMatchObject({ usage: { input: expect.any(Number), totalTokens: expect.any(Number) } });
		expect(parent.isIdle).not.toHaveBeenCalled();
		expect(parent.abort).not.toHaveBeenCalled();
		expect(JSON.stringify(parent.sessionManager.getEntries())).not.toContain("Keep it read-only; evidence verified.");
	}, 30_000);

	it("takes a new independent snapshot for each call", async () => {
		const { faux, parent, pi } = setup();
		const tool = createClarifyTool(pi, parent);
		const { sessions, disposals } = observeForks();
		const seen: string[] = [];
		faux.setResponses(
			[1, 2].map((n) => (context) => {
				seen.push(JSON.stringify(context.messages));
				return fauxAssistantMessage([fauxText(`answer-${n}`)]);
			}),
		);
		await tool.execute("first", { question: "first question" }, undefined, undefined, parent);
		parent.sessionManager.appendMessage({ role: "user", content: "New parent decision", timestamp: 7 });
		await tool.execute("second", { question: "second question" }, undefined, undefined, parent);
		expect(seen[0]).not.toContain("New parent decision");
		expect(seen[1]).toContain("New parent decision");
		expect(seen[1]).not.toContain("answer-1");
		expect(sessions[0].sessionId).not.toBe(sessions[1].sessionId);
		for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
	}, 30_000);

	it("cancels the ephemeral fork when its child is stopped and disposes it", async () => {
		const { faux, parent, pi } = setup();
		const { disposals } = observeForks();
		const manager = new AgentManager();
		cleanup.push(() => manager.dispose());
		let entered!: () => void;
		const enteredFork = new Promise<void>((resolve) => {
			entered = resolve;
		});
		faux.setResponses([
			() => fauxAssistantMessage([fauxToolCall("clarify", { question: "Help?" })], { stopReason: "toolUse" }),
			async (_context, options) => {
				entered();
				await new Promise<void>((resolve) =>
					options!.signal!.addEventListener("abort", () => resolve(), { once: true }),
				);
				return fauxAssistantMessage([], { stopReason: "aborted" });
			},
		]);
		const id = manager.spawn(pi, parent, config.name, "ask", {
			description: "test",
			agentConfig: config,
			enableClarify: true,
			loadStandardChildExtensions: false,
		});
		await enteredFork;
		manager.abort(id);
		await manager.getRecord(id)!.promise;
		expect(manager.getRecord(id)!.status).toBe("stopped");
		expect(disposals[0]).toHaveBeenCalledTimes(1);
		expect(parent.abort).not.toHaveBeenCalled();
	}, 30_000);

	it("reports provider failures rather than inherited parent answers, and always disposes", async () => {
		const { faux, parent, pi } = setup();
		parent.sessionManager.appendMessage(fauxAssistantMessage([fauxText("old parent answer")]));
		const { disposals } = observeForks();
		faux.setResponses([() => fauxAssistantMessage([], { stopReason: "error", errorMessage: "request rejected" })]);
		await expect(
			createClarifyTool(pi, parent).execute("failure", { question: "Help?" }, undefined, undefined, parent),
		).rejects.toThrow("request rejected");
		expect(disposals[0]).toHaveBeenCalledTimes(1);
	}, 30_000);

	it("avoids creating a fork for a blank question or an already cancelled call", async () => {
		const { parent, pi } = setup();
		const tool = createClarifyTool(pi, parent);
		await expect(tool.execute("blank", { question: " " }, undefined, undefined, parent)).rejects.toThrow("blank");
		await expect(
			tool.execute("cancelled", { question: "Help?" }, AbortSignal.abort(), undefined, parent),
		).rejects.toThrow();
		expect(pi.exec).not.toHaveBeenCalled();
	});
});

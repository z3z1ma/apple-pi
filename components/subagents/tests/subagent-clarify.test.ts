import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import type {
	AgentSession,
	ExtensionContext,
	ExtensionFactory,
	ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import { inForkedContinuation } from "../../shared/src/fork-context.js";
import * as forks from "../../shared/src/forked-continuation.js";
import { AgentManager } from "../src/agent-manager.js";
import { createClarifyTool } from "../src/clarify.js";
import type { AgentConfig } from "../src/types.js";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
	for (const fn of cleanup.splice(0).reverse()) await fn();
	vi.restoreAllMocks();
});

function lastText(context: Context): string {
	return JSON.stringify(context.messages.at(-1));
}

async function setup(extensions: ExtensionFactory[] = []) {
	const manager = new AgentManager();
	cleanup.push(() => manager.dispose());
	let parent!: ExtensionContext;
	let reply: (context: Context) => Reply | "until-aborted" = () => fauxAssistantMessage("settled");
	const run = await fauxSession(
		[
			(pi) => {
				pi.on("session_start", (_event, ctx) => {
					parent = ctx;
				});
			},
			...extensions,
		],
		(context) => reply(context),
		["read", "write", "edit", "bash", "ls", "grep", "find"],
	);
	cleanup.push(run.dispose);
	const stream = run.session.agent.streamFunction;
	const optionsSeen: Array<{ sessionId?: string; reasoning?: string; model: string }> = [];
	run.session.agent.streamFunction = (model, context, options) => {
		optionsSeen.push({ sessionId: options?.sessionId, reasoning: options?.reasoning, model: model.id });
		return stream(model, context, options);
	};
	await run.session.prompt("Original parent request");
	return {
		...run,
		manager,
		parent,
		optionsSeen,
		respond: (next: typeof reply) => {
			reply = next;
		},
	};
}

function execute(parent: ExtensionContext, question: string, signal?: AbortSignal) {
	return createClarifyTool(parent).execute("question", { question }, signal, undefined, parent as ExtensionToolContext);
}

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

describe("clarify live parent forks", () => {
	it("answers at pool capacity and returns usage only to the calling child", async () => {
		const run = await setup();
		const previousDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = join(run.cwd, "agent");
		cleanup.push(() => {
			if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousDir;
		});
		const manager = run.manager;
		manager.setMaxConcurrent(1);
		const before = structuredClone(run.session.sessionManager.getEntries());
		run.respond(() => ({
			...fauxAssistantMessage("Parent advice"),
			usage: { ...fauxAssistantMessage("").usage, input: 100, output: 10, totalTokens: 110 },
		}));
		let turn = 0;
		const id = manager.spawn(
			{ exec: vi.fn(async () => ({ code: 1, stdout: "", stderr: "" })) } as any,
			run.parent,
			config.name,
			"Ask the parent",
			{
				description: "test",
				agentConfig: config,
				isBackground: true,
				enableClarify: true,
				loadStandardChildExtensions: false,
				onSessionCreated: (child) => {
					child.agent.streamFunction = (_model, context) => {
						const message =
							turn++ === 0
								? fauxAssistantMessage(fauxToolCall("clarify", { question: "What was decided?" }), {
										stopReason: "toolUse",
									})
								: fauxAssistantMessage("CHILD-DONE");
						if (turn > 1) expect(JSON.stringify(context.messages)).toContain("Parent advice");
						const events = createAssistantMessageEventStream();
						events.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
						events.end(message);
						return events;
					};
				},
			},
		);
		const record = manager.getRecord(id)!;
		await record.promise;
		expect(record.error).toBeUndefined();
		expect(record.result).toBe("CHILD-DONE");
		const result = record.session!.messages.find(
			(message) => message.role === "toolResult" && message.toolName === "clarify",
		);
		expect(result).toMatchObject({ usage: { input: 100, output: 10, totalTokens: 110 } });
		expect(record.lifetimeUsage).toMatchObject({ input: 100, output: 10 });
		expect(run.session.sessionManager.getEntries()).toEqual(before);
	}, 30_000);

	it("preserves the request prefix, model, reasoning, tools, and cache identity", async () => {
		const run = await setup();
		const before = structuredClone(run.session.sessionManager.getEntries());
		const parentRequest = run.requests.at(-1)!;
		run.respond(() => ({
			...fauxAssistantMessage("Stay in the agreed scope."),
			usage: { ...fauxAssistantMessage("").usage, input: 100, output: 10, totalTokens: 110 },
		}));
		const result = await execute(run.parent, "What is the scope?");
		const request = run.requests.at(-1)!;
		expect(request.systemPrompt).toEqual(parentRequest.systemPrompt);
		expect(request.tools).toEqual(parentRequest.tools);
		expect(request.messages.slice(0, parentRequest.messages.length)).toEqual(parentRequest.messages);
		expect(request.messages.slice(parentRequest.messages.length).map((message) => message.role)).toEqual([
			"assistant",
			"user",
		]);
		expect(lastText(request)).toContain("What is the scope?");
		expect(run.optionsSeen.at(-1)).toEqual(run.optionsSeen[0]);
		expect(result.content).toEqual([{ type: "text", text: "Stay in the agreed scope." }]);
		expect(result.usage).toMatchObject({ input: 100, output: 10, totalTokens: 110 });
		expect(run.session.sessionManager.getEntries()).toEqual(before);
	});

	it("takes a fresh independent projection and the current parent model for every invocation", async () => {
		const run = await setup();
		run.respond(() => fauxAssistantMessage("answer-1"));
		await execute(run.parent, "first question");
		run.respond(() => fauxAssistantMessage("New settled decision"));
		await run.session.prompt("New parent decision");
		const current = { ...run.session.agent.state.model, id: "current-parent-model" };
		run.session.agent.state.model = current;
		run.session.agent.state.thinkingLevel = "high";
		run.respond(() => fauxAssistantMessage("answer-2"));
		const second = await execute(run.parent, "second question");
		const request = run.requests.at(-1)!;
		expect(JSON.stringify(request.messages)).toContain("New parent decision");
		expect(JSON.stringify(request.messages)).not.toContain("answer-1");
		expect(JSON.stringify(request.messages)).not.toContain("first question");
		expect(run.optionsSeen.at(-1)).toMatchObject({
			model: current.id,
			reasoning: "high",
			sessionId: run.session.agent.sessionId,
		});
		expect(second.details.model).toBe(current.id);
	});

	it("uses the compacted active branch, images, and tool evidence without modifying parent messages", async () => {
		const run = await setup();
		const sm = run.session.sessionManager;
		const abandoned = sm.appendMessage({ role: "user", content: "abandoned branch", timestamp: 2 });
		sm.branch(sm.getEntry(abandoned)!.parentId!);
		const kept = sm.appendMessage({
			role: "user",
			content: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
			timestamp: 3,
		});
		sm.appendCompaction("Earlier decisions", kept, 1000);
		sm.appendMessage(
			fauxAssistantMessage([fauxToolCall("read", { path: "done" }, { id: "read-done" })], { stopReason: "toolUse" }),
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
		run.respond(() => fauxAssistantMessage("answer"));
		await execute(run.parent, "What is known?");
		const messages = JSON.stringify(run.requests.at(-1)!.messages);
		expect(messages).toContain("Earlier decisions");
		expect(messages).toContain("image/png");
		expect(messages).toContain("observed evidence");
		expect(messages).not.toContain("abandoned branch");
		expect(messages).not.toContain("Original parent request");
		expect(sm.getEntries()).toEqual(before);
	});

	it("appends placeholders for unfinished parent tools without executing them or changing the prefix", async () => {
		let session!: AgentSession;
		let parent!: ExtensionContext;
		let answer: unknown;
		const pending: ExtensionFactory = (pi) => {
			pi.on("session_start", (_event, ctx) => {
				parent = ctx;
			});
			pi.registerTool({
				name: "pending",
				label: "Pending",
				description: "A live parent tool",
				parameters: Type.Object({}),
				async execute() {
					const before = structuredClone(session.sessionManager.buildSessionProjection().messages);
					answer = await execute(parent, "Explain while the parent is working");
					expect(session.sessionManager.buildSessionProjection().messages).toEqual(before);
					return { content: [{ type: "text", text: "real parent result" }], details: {} };
				},
			});
		};
		forks.trackLiveSessions();
		const run = await fauxSession(
			[pending],
			(context) => {
				if (lastText(context).includes("Explain while")) return fauxAssistantMessage("fork answer");
				if (context.messages.at(-1)?.role === "toolResult") return fauxAssistantMessage("parent done");
				return fauxAssistantMessage(fauxToolCall("pending", {}, { id: "pending-parent" }), { stopReason: "toolUse" });
			},
			["pending"],
		);
		cleanup.push(run.dispose);
		session = run.session;
		await session.prompt("go");
		const forkRequest = run.requests.find((request) => lastText(request).includes("Explain while"))!;
		const parentNext = run.requests.at(-1)!;
		const placeholder = forkRequest.messages.at(-2);
		expect(placeholder).toMatchObject({ role: "toolResult", toolCallId: "pending-parent", isError: true });
		expect(JSON.stringify(placeholder)).toContain("unavailable at clarification snapshot time");
		expect(forkRequest.messages.slice(0, -2)).toEqual(parentNext.messages.slice(0, -1));
		expect(forkRequest.tools).toEqual(parentNext.tools);
		expect(answer).toMatchObject({ content: [{ text: "fork answer" }] });
	});

	it("executes read-only tools through the parent hooks and blocks mutations, delegation, and further clarification", async () => {
		const seen: string[] = [];
		const run = await setup([
			(pi) => {
				pi.on("tool_call", (event) => {
					expect(inForkedContinuation()).toBe(true);
					seen.push(event.toolName);
				});
				for (const name of ["agent", "clarify"])
					pi.registerTool({
						name,
						label: name,
						description: "blocked",
						parameters: Type.Object({}),
						execute: async () => {
							throw new Error("must not execute");
						},
					});
			},
		]);
		run.session.setActiveToolsByName([...run.session.getActiveToolNames(), "agent", "clarify"]);
		writeFileSync(join(run.cwd, "evidence.txt"), "verified locally");
		let turn = 0;
		run.respond((context) => {
			if (turn++ === 0)
				return fauxAssistantMessage(
					[
						fauxToolCall("read", { path: "evidence.txt" }, { id: "read" }),
						fauxToolCall("write", { path: "escaped.txt", content: "bad" }, { id: "write" }),
						fauxToolCall("bash", { command: "touch escaped.txt" }, { id: "bash" }),
						fauxToolCall("agent", {}, { id: "agent" }),
						fauxToolCall("clarify", {}, { id: "clarify" }),
					],
					{ stopReason: "toolUse" },
				);
			expect(JSON.stringify(context.messages)).toContain("verified locally");
			for (const tool of ["write", "bash", "agent", "clarify"])
				expect(
					context.messages.find((message) => message.role === "toolResult" && message.toolCallId === tool),
				).toMatchObject({ isError: true });
			return fauxAssistantMessage("Keep it read-only; evidence verified.");
		});
		const result = await execute(run.parent, "Check the evidence");
		expect(result.content[0]).toMatchObject({ text: "Keep it read-only; evidence verified." });
		expect(seen).toEqual(["read"]);
		expect(existsSync(join(run.cwd, "escaped.txt"))).toBe(false);
		expect(inForkedContinuation()).toBe(false);
	});

	it("cancels clarification when its calling child is stopped", async () => {
		const run = await setup();
		const previousDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = join(run.cwd, "agent");
		cleanup.push(() => {
			if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousDir;
		});
		const manager = run.manager;
		let entered!: () => void;
		const pending = new Promise<void>((resolve) => {
			entered = resolve;
		});
		run.respond(() => {
			entered();
			return "until-aborted";
		});
		let forkSignal: AbortSignal | undefined;
		const original = run.session.agent.streamFunction;
		run.session.agent.streamFunction = (model, context, options) => {
			forkSignal = options?.signal;
			return original(model, context, options);
		};
		const id = manager.spawn(
			{ exec: vi.fn(async () => ({ code: 1, stdout: "", stderr: "" })) } as any,
			run.parent,
			config.name,
			"Ask the parent",
			{
				description: "test",
				agentConfig: config,
				enableClarify: true,
				loadStandardChildExtensions: false,
				onSessionCreated: (child) => {
					child.agent.streamFunction = (_model, _context, options) => {
						const message = options?.signal?.aborted
							? fauxAssistantMessage("", { stopReason: "aborted" })
							: fauxAssistantMessage(fauxToolCall("clarify", { question: "Help?" }), { stopReason: "toolUse" });
						const events = createAssistantMessageEventStream();
						if (message.stopReason === "aborted") events.push({ type: "error", reason: "aborted", error: message });
						else events.push({ type: "done", reason: "toolUse", message });
						events.end(message);
						return events;
					};
				},
			},
		);
		await pending;
		manager.abort(id);
		await manager.getRecord(id)!.promise;
		expect(manager.getRecord(id)!.status).toBe("stopped");
		expect(forkSignal?.aborted).toBe(true);
		run.respond(() => fauxAssistantMessage("parent still works"));
		await run.session.prompt("Continue the parent task");
		expect(run.session.getLastAssistantText()).toBe("parent still works");
	}, 30_000);

	it("cancels only the ephemeral fork and releases a call while the provider is still settling", async () => {
		const run = await setup();
		let release!: () => void;
		let entered!: () => void;
		const pending = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const original = run.session.agent.streamFunction;
		let forkSignal: AbortSignal | undefined;
		run.session.agent.streamFunction = async (model, context, options) => {
			forkSignal = options?.signal;
			entered();
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return original(model, context, options);
		};
		run.respond(() => "until-aborted");
		const controller = new AbortController();
		const call = execute(run.parent, "Help?", controller.signal);
		await pending;
		controller.abort();
		await expect(call).rejects.toThrow();
		expect(forkSignal?.aborted).toBe(true);
		release();
		run.session.agent.streamFunction = original;
		run.respond(() => fauxAssistantMessage("parent still works"));
		await run.session.prompt("Continue the parent task");
		expect(run.session.getLastAssistantText()).toBe("parent still works");
	});

	it("reports failed or empty replies instead of returning an inherited parent answer", async () => {
		const run = await setup();
		run.respond(() => fauxAssistantMessage([], { stopReason: "error", errorMessage: "request rejected" }));
		await expect(execute(run.parent, "Help?")).rejects.toThrow("request rejected");
		run.respond(() => fauxAssistantMessage(""));
		await expect(execute(run.parent, "Help?")).rejects.toThrow("without a reply");
	});

	it("fails closed for an unavailable live parent, blank question, or cancelled caller", async () => {
		const run = await setup();
		const requestCount = run.requests.length;
		await expect(execute(run.parent, " ")).rejects.toThrow("blank");
		await expect(execute(run.parent, "Help?", AbortSignal.abort())).rejects.toThrow();
		const missing = { ...run.parent, sessionManager: {} } as ExtensionContext;
		await expect(execute(missing, "Help?")).rejects.toThrow("live parent session is not available");
		expect(run.requests).toHaveLength(requestCount);
	});
});

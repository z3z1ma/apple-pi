// Evidence for spec section 15 answers V1, V3, V4, V7, and the argument-remap finding.
// It ran from components/shared/tests/ on 2026-10-03 (Pi 0.99.0). Copy it there to rerun; it is not a product test.
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import type { AgentSession, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const dispose of cleanup.splice(0)) dispose();
});

const als = new AsyncLocalStorage<string>();
const seenInExecute = new Map<string, string | undefined>();
const seenInHook = new Map<string, string | undefined>();
let pendingSession: AgentSession | undefined;
const pendingObservations: Record<string, unknown> = {};

function tool(name: string, args: Record<string, unknown>, id: string): Reply {
	return fauxAssistantMessage(fauxToolCall(name, args, { id }), { stopReason: "toolUse" });
}

function forkOf(session: AgentSession, messages: AgentMessage[], streamFn?: Agent["streamFunction"]) {
	const parent = session.agent;
	return new Agent({
		initialState: {
			systemPrompt: parent.state.systemPrompt,
			model: parent.state.model,
			thinkingLevel: parent.state.thinkingLevel,
			tools: parent.state.tools,
			messages,
		},
		convertToLlm: parent.convertToLlm,
		transformContext: parent.transformContext,
		streamFn: streamFn ?? parent.streamFunction,
		getApiKey: parent.getApiKey,
		beforeToolCall: parent.beforeToolCall,
		afterToolCall: parent.afterToolCall,
		sessionId: parent.sessionId,
		toolExecution: parent.toolExecution,
	});
}

function probeExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "probe",
		label: "Probe",
		description: "probe",
		parameters: Type.Object({}),
		async execute(toolCallId) {
			await new Promise((resolve) => setTimeout(resolve, 20));
			seenInExecute.set(toolCallId, als.getStore());
			return { content: [{ type: "text", text: `probe ${toolCallId}` }], details: {} };
		},
	});
	pi.on("tool_call", (event) => {
		seenInHook.set(event.toolCallId, als.getStore());
	});
	pi.registerTool({
		name: "pending",
		label: "Pending",
		description: "pending",
		parameters: Type.Object({}),
		async execute(toolCallId) {
			const session = pendingSession as AgentSession;
			const messages = session.sessionManager.buildSessionProjection().messages;
			const last = messages.at(-1);
			pendingObservations.lastRole = last?.role;
			pendingObservations.lastHasCall =
				last?.role === "assistant" && last.content.some((b) => b.type === "toolCall" && b.id === toolCallId);
			const fork = forkOf(session, messages);
			await fork.prompt([
				{
					role: "toolResult",
					toolCallId,
					toolName: "pending",
					content: [{ type: "text", text: "FORK PROMPT" }],
					isError: false,
					timestamp: Date.now(),
				},
			]);
			const reply = fork.state.messages.at(-1);
			pendingObservations.forkStop = reply?.role === "assistant" ? reply.stopReason : reply?.role;
			pendingObservations.forkError = reply?.role === "assistant" ? reply.errorMessage : undefined;
			return { content: [{ type: "text", text: "REAL RESULT" }], details: {} };
		},
	});
}

describe("branch search spikes", () => {
	it("V1: concurrent forks keep distinct async contexts through hooks and tool execution", async () => {
		const run = await fauxSession([probeExtension], [fauxAssistantMessage("settled")], ["read", "probe"]);
		cleanup.push(run.dispose);
		await run.session.prompt("hello");
		const base = run.session.sessionManager.buildSessionProjection().messages;
		const queue = [
			tool("probe", {}, "call-1"),
			tool("probe", {}, "call-2"),
			fauxAssistantMessage("fork done"),
			fauxAssistantMessage("fork done"),
		];
		const stream = (() => fauxStream(queue.shift() ?? fauxAssistantMessage("done"))) as unknown as Agent["streamFunction"];
		const forks = { A: forkOf(run.session, base, stream), B: forkOf(run.session, base, stream) };
		await Promise.all(
			Object.entries(forks).map(([name, fork]) =>
				als.run(name, () =>
					fork.prompt({ role: "custom", customType: "spike", content: name, display: false, timestamp: Date.now() }),
				),
			),
		);
		const owner = (id: string) =>
			Object.entries(forks).find(([, fork]) =>
				fork.state.messages.some((m) => m.role === "assistant" && m.content.some((b) => b.type === "toolCall" && b.id === id)),
			)?.[0];
		const result = ["call-1", "call-2"].map((id) => ({
			id,
			owner: owner(id),
			hook: seenInHook.get(id),
			execute: seenInExecute.get(id),
		}));
		console.log("V1", JSON.stringify(result));
		for (const row of result) {
			expect(row.owner).toBeDefined();
			expect(row.hook).toBe(row.owner);
			expect(row.execute).toBe(row.owner);
		}
	});

	it("V3: a fork starts from a pending tool call by appending a tool result", async () => {
		const run = await fauxSession(
			[probeExtension],
			[tool("pending", {}, "pend-1"), fauxAssistantMessage("fork reply"), fauxAssistantMessage("parent done")],
			["read", "pending"],
		);
		cleanup.push(run.dispose);
		pendingSession = run.session;
		await run.session.prompt("go");
		console.log("V3 observations", JSON.stringify(pendingObservations));
		const [first, fork, parentAfter] = run.requests;
		const roles = (r: typeof first) => r?.messages.map((m) => m.role);
		console.log("V3 roles", JSON.stringify({ first: roles(first), fork: roles(fork), parentAfter: roles(parentAfter) }));
		expect(pendingObservations.lastHasCall).toBe(true);
		const shared = parentAfter!.messages.length - 1;
		expect(fork!.messages.slice(0, shared)).toEqual(parentAfter!.messages.slice(0, shared));
		expect(fork!.systemPrompt).toEqual(parentAfter!.systemPrompt);
		expect(JSON.stringify(fork!.tools)).toEqual(JSON.stringify(parentAfter!.tools));
		expect(JSON.stringify(fork!.messages.at(-1))).toContain("FORK PROMPT");
		expect(JSON.stringify(parentAfter!.messages.at(-1))).toContain("REAL RESULT");
	});

	it("V4: aborting one fork leaves a sibling fork running to completion", async () => {
		const run = await fauxSession([probeExtension], [fauxAssistantMessage("settled")], ["probe"]);
		cleanup.push(run.dispose);
		await run.session.prompt("hello");
		const base = run.session.sessionManager.buildSessionProjection().messages;
		const hanging = ((_model: unknown, _context: unknown, options?: { signal?: AbortSignal }) => {
			const events = createAssistantMessageEventStream();
			options?.signal?.addEventListener("abort", () => {
				const error = { ...fauxAssistantMessage(""), stopReason: "aborted" as const, errorMessage: "aborted" };
				events.push({ type: "error", reason: "aborted", error });
				events.end(error);
			});
			return events;
		}) as unknown as Agent["streamFunction"];
		const quick = (() => fauxStream(fauxAssistantMessage("finished"))) as unknown as Agent["streamFunction"];
		const a = forkOf(run.session, base, hanging);
		const b = forkOf(run.session, base, quick);
		const prompt = (fork: Agent) =>
			fork.prompt({ role: "custom", customType: "spike", content: "x", display: false, timestamp: Date.now() });
		const runs = [prompt(a), prompt(b)];
		setTimeout(() => a.abort(), 5);
		await Promise.all(runs);
		const stop = (fork: Agent) => {
			const last = fork.state.messages.at(-1);
			return last?.role === "assistant" ? last.stopReason : last?.role;
		};
		console.log("V4", JSON.stringify({ a: stop(a), b: stop(b), parentStreaming: run.session.isStreaming }));
		expect(stop(a)).toBe("aborted");
		expect(stop(b)).toBe("stop");
		expect(run.session.isStreaming).toBe(false);
	});
});

function fauxStream(message: Reply) {
	const events = createAssistantMessageEventStream();
	events.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
	events.end(message);
	return events;
}

describe("remap spike", () => {
	it("a fork-local beforeToolCall can rewrite args before the parent's core tool runs", async () => {
		const run = await fauxSession([], [fauxAssistantMessage("settled")], ["read"]);
		cleanup.push(run.dispose);
		await run.session.prompt("hello");
		const worktree = mkdtempSync(join(tmpdir(), "spike-wt-"));
		writeFileSync(join(worktree, "app.ts"), "export const value = 'worktree';\n");
		const base = run.session.sessionManager.buildSessionProjection().messages;
		const queue = [tool("read", { path: "app.ts" }, "read-1"), fauxAssistantMessage("done")];
		const stream = (() => fauxStream(queue.shift() ?? fauxAssistantMessage("done"))) as unknown as Agent["streamFunction"];
		const fork = forkOf(run.session, base, stream);
		const parentBefore = run.session.agent.beforeToolCall;
		fork.beforeToolCall = async (context, signal) => {
			const args = context.args as { path?: string };
			if (typeof args.path === "string") args.path = join(worktree, args.path);
			return parentBefore?.(context, signal);
		};
		await fork.prompt({ role: "custom", customType: "spike", content: "x", display: false, timestamp: Date.now() });
		const result = fork.state.messages.find((m) => m.role === "toolResult");
		const call = fork.state.messages.find((m) => m.role === "assistant" && m.content.some((b) => b.type === "toolCall"));
		console.log("REMAP", JSON.stringify({ result: result?.role === "toolResult" ? result.content : null, storedArgs: call?.role === "assistant" ? call.content : null }));
		expect(JSON.stringify(result)).toContain("worktree");
	});
});

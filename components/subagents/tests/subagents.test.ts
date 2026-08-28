import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveResultWaitMode, waitForAgentSettlement } from "../src/abortable.js";
import { AgentManager } from "../src/agent-manager.js";
import { selectAgentModel } from "../src/agent-runner.js";
import { BUILTIN_TOOL_NAMES, buildAgentRegistry, getToolNamesForType, resolveSpawnTypeIn } from "../src/agent-types.js";
import {
	BTW_AGENT_CONFIG,
	buildBtwInjection,
	buildBtwParentSnapshot,
	buildBtwPrompt,
	formatBtwUserMessage,
	getLatestBtwExchange,
} from "../src/btw.js";
import { buildFullParentContext } from "../src/context.js";
import { getAgentConversation, TRANSCRIPT_TAIL_MAX_CHARS } from "../src/conversation.js";
import { loadCustomAgents } from "../src/custom-agents.js";
import { DEFAULT_AGENTS } from "../src/default-agents.js";
import { createParentEscalationTool, ParentEscalationHub } from "../src/escalation.js";
import { resolveAgentInvocationConfig } from "../src/invocation-config.js";
import { resolveAgentProfile } from "../src/model-routing.js";
import { createNestedSubagentTools } from "../src/nested-tools.js";
import { formatNotification } from "../src/notifications.js";
import { applySettings, loadSettings, saveSettings } from "../src/settings.js";
import type { AgentConfig } from "../src/types.js";
import { DEFAULT_AGENT_NAMES } from "../src/types.js";

const roots: string[] = [];
const temporaryRoot = (): string => {
	const root = mkdtempSync(join(tmpdir(), "apple-pi-subagents-"));
	roots.push(root);
	return root;
};

afterEach(() => {
	vi.useRealTimers();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("owned subagent surface", () => {
	it("steers the root when the escalating agent has no active result wait", async () => {
		const deliver = vi.fn();
		const hub = new ParentEscalationHub(deliver);
		const outcome = hub.escalate("agent-1", "The API contract is contradictory.");
		expect(outcome).toBe("steered");
		expect(deliver).toHaveBeenCalledWith({
			agentId: "agent-1",
			message: "The API contract is contradictory.",
		});
	});

	it("wakes every active result wait when the escalating agent is among them", async () => {
		const deliver = vi.fn();
		const hub = new ParentEscalationHub(deliver);
		const matching = hub.registerWait("agent-1");
		const other = hub.registerWait("agent-2");

		expect(hub.escalate("agent-1", "A migration would destroy user data.")).toBe("woke-waits");
		await expect(matching.promise).resolves.toEqual({
			agentId: "agent-1",
			message: "A migration would destroy user data.",
		});
		await expect(other.promise).resolves.toEqual({
			agentId: "agent-1",
			message: "A migration would destroy user data.",
		});
		expect(deliver).not.toHaveBeenCalled();
		expect(hub.escalate("agent-1", "A second, distinct escalation.")).toBe("steered");
		expect(deliver).toHaveBeenCalledWith({ agentId: "agent-1", message: "A second, distinct escalation." });
		matching.close();
		other.close();
	});

	it("detaches a foreground escalation from its caller signal", () => {
		const manager = new AgentManager();
		const detachCallerSignal = vi.fn();
		(manager as any).agents.set("agent-1", {
			id: "agent-1",
			status: "running",
			isBackground: false,
			detachCallerSignal,
		});
		expect(manager.detachForeground("agent-1")).toBe(true);
		expect(detachCallerSignal).toHaveBeenCalledOnce();
		expect(manager.getRecord("agent-1")).toMatchObject({ isBackground: true, resultConsumed: false });
		manager.dispose();
	});

	it("keeps escalate_to_parent reserved for urgent asynchronous communication", async () => {
		const escalate = vi.fn(() => "steered" as const);
		const tool = createParentEscalationTool("agent-1", escalate);
		expect(tool.name).toBe("escalate_to_parent");
		expect(tool.description).toContain("Continue working after calling it");
		expect(tool.promptGuidelines?.join(" ")).toContain("Do not use it for routine progress updates");
		const result = await (tool as any).execute("escalate", { message: "Need a root decision now." });
		expect(escalate).toHaveBeenCalledWith("agent-1", "Need a root decision now.");
		expect(result.content[0].text).toContain("Continue working");
	});
	it("keeps automatic completion notifications to a preview", () => {
		const output = "x".repeat(750);
		const notification = formatNotification(
			{
				id: "agent-1",
				type: "Explore",
				description: "large result",
				status: "completed",
				result: output,
				toolUses: 0,
				startedAt: Date.now(),
				lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
				compactionCount: 0,
			},
			500,
		);
		expect(notification).toContain(`${"x".repeat(500)}\n...(truncated; use get_subagent_result for full output)`);
		expect(notification).not.toContain(output);
	});

	it("uses the quick profile for the built-in read-only explorer", () => {
		expect(DEFAULT_AGENTS.get("Explore")).toMatchObject({ profile: "quick" });
	});

	it("keeps BTW private and read-only", () => {
		expect(BTW_AGENT_CONFIG).toMatchObject({
			builtinToolNames: ["read", "grep", "find", "ls"],
			extensions: false,
			skills: false,
			pair: false,
			persistSession: false,
			promptMode: "replace",
		});
	});

	it("gives each BTW visit an append-only, bounded conversation snapshot", () => {
		const branch = [
			{ id: "1", type: "message", message: { role: "user", content: [{ type: "text", text: "older context" }] } },
			{
				id: "2",
				type: "message",
				message: { role: "toolResult", content: [{ type: "text", text: "private tool output" }] },
			},
			{
				id: "3",
				type: "message",
				message: { role: "assistant", content: [{ type: "text", text: "latest answer" }] },
			},
		];
		const first = buildBtwParentSnapshot(branch);
		const prompt = buildBtwPrompt(first.context, "side question");
		expect(first.cursor).toBe("3");
		expect(prompt).toContain("older context");
		expect(prompt).toContain("latest answer");
		expect(prompt).toContain("side question");
		expect(prompt).not.toContain("private tool output");
		expect(formatBtwUserMessage(prompt)).toBe("side question");
		const markerInContext = buildBtwPrompt(
			"[Parent user]\nThe source contains <btw-question>not the visible question</btw-question>.",
			"actual side question",
		);
		expect(formatBtwUserMessage(markerInContext)).toBe("actual side question");

		const nextBranch = [
			...branch,
			{ id: "4", type: "message", message: { role: "user", content: "new root question" } },
			{ id: "5", type: "message", message: { role: "assistant", content: [{ type: "text", text: "new progress" }] } },
		];
		const delta = buildBtwParentSnapshot(
			[
				...nextBranch,
				{
					id: "6",
					type: "message",
					message: { role: "user", content: buildBtwInjection({ question: "q", answer: "a" }) },
				},
			],
			first.cursor,
		);
		expect(delta.context).toContain("new root question");
		expect(delta.context).toContain("new progress");
		expect(delta.context).not.toContain("older context");
		expect(delta.context).not.toContain("[BTW side conversation]");
		expect(delta.cursor).toBe("6");

		const compacted = buildBtwParentSnapshot([
			{ id: "1", type: "message", message: { role: "user", content: "superseded context" } },
			{ id: "2", type: "compaction", summary: "current summary" },
			{ id: "3", type: "message", message: { role: "user", content: "after compaction" } },
		]);
		expect(compacted.context).toContain("current summary");
		expect(compacted.context).toContain("after compaction");
		expect(compacted.context).not.toContain("superseded context");

		const bounded = buildBtwParentSnapshot([
			{ id: "1", type: "message", message: { role: "user", content: "x".repeat(20_000) } },
		]);
		expect(bounded.context.length).toBeLessThanOrEqual(12_000);
	});

	it("extracts only the latest completed BTW exchange for injection", () => {
		const messages = [
			{ role: "user", content: buildBtwPrompt("root context", "Why is this failing?") },
			{ role: "assistant", content: [{ type: "text", text: "Because the guard is inverted." }], stopReason: "stop" },
			{ role: "user", content: "Can you be more specific?" },
			{
				role: "assistant",
				content: [{ type: "text", text: "The condition on line 12 is reversed." }],
				stopReason: "stop",
			},
		];
		const exchange = getLatestBtwExchange(messages);
		expect(exchange).toEqual({
			question: "Can you be more specific?",
			answer: "The condition on line 12 is reversed.",
		});
		expect(buildBtwInjection(exchange!)).toContain("The condition on line 12 is reversed.");
		expect(buildBtwInjection(exchange!)).not.toContain("Because the guard is inverted.");
	});

	it("registers the specialist catalog as built-ins with lane-specific tools", () => {
		expect([...DEFAULT_AGENTS.keys()]).toEqual([...DEFAULT_AGENT_NAMES]);
		expect(DEFAULT_AGENTS.get("Research")).toMatchObject({
			profile: "quick",
			builtinToolNames: ["read", "bash", "grep", "find", "ls"],
			extensions: false,
			skills: false,
			promptMode: "replace",
		});
		expect(DEFAULT_AGENTS.get("Advisor")).toMatchObject({
			profile: "deep",
			builtinToolNames: ["read", "bash", "grep", "find", "ls"],
			promptMode: "replace",
		});
		expect(DEFAULT_AGENTS.get("Implement")).toMatchObject({
			profile: "coding",
			pair: true,
			extensions: false,
			skills: false,
			promptMode: "replace",
		});
		expect(DEFAULT_AGENTS.get("Implement")?.builtinToolNames).toBeUndefined();
		expect(DEFAULT_AGENTS.get("Design")).toMatchObject({
			profile: "visual-engineering",
			extensions: false,
			skills: false,
			promptMode: "replace",
		});
		expect(DEFAULT_AGENTS.get("Research")?.systemPrompt).toMatch(/Not local reconnaissance/);
		expect(DEFAULT_AGENTS.get("Research")?.systemPrompt).toMatch(/no docs tools/);
		expect(DEFAULT_AGENTS.get("Research")?.description).toMatch(/session extensions \(MCP\)/);
		expect(DEFAULT_AGENTS.get("Advisor")?.systemPrompt).toMatch(/You advise; you do not implement/);
		expect(DEFAULT_AGENTS.get("Implement")?.systemPrompt).toMatch(/that is Design/);
		expect(DEFAULT_AGENTS.get("Design")?.systemPrompt).toMatch(/refuse it/);
	});

	it("fails unknown, disabled, missing, and ambiguous dispatch closed", () => {
		const disabled = {
			...DEFAULT_AGENTS.get("Implement")!,
			name: "Disabled",
			enabled: false,
			isDefault: false,
		};
		const registry = buildAgentRegistry(
			new Map([
				["Disabled", disabled],
				["case", { ...disabled, name: "case", enabled: true }],
				["CASE", { ...disabled, name: "CASE", enabled: true }],
			]),
		);
		for (const requested of ["missing", "Disabled", "", "CaSe"]) {
			const result = resolveSpawnTypeIn(registry, requested);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.message).toContain("Available:");
		}
		expect(getToolNamesForType("missing")).toEqual([]);
	});

	it("rejects custom agent profiles outside the known inference profile set", () => {
		const root = temporaryRoot();
		mkdirSync(join(root, ".pi", "agents"), { recursive: true });
		writeFileSync(
			join(root, ".pi", "agents", "unknown-profile.md"),
			"---\nname: unknown-profile\ndescription: Invalid profile\nprofile: custom-fast\n---\n\nInvalid instructions.\n",
		);
		expect(() => loadCustomAgents({ cwd: root, projectTrusted: true }, true)).toThrow(
			/profile must be one of: quick, balanced, pair, deep, coding, visual-engineering, background/,
		);
	});

	it("resolves semantic profiles exactly and lets an invocation override the type default", () => {
		const root = temporaryRoot();
		const globalRoot = join(root, "pi-agent");
		mkdirSync(globalRoot, { recursive: true });
		writeFileSync(
			join(globalRoot, "model-profiles.json"),
			JSON.stringify({
				profiles: {
					quick: { model: "anthropic/fast", thinking: "low" },
					deep: { model: "anthropic/deep", thinking: "xhigh" },
					background: { model: "anthropic/fast", thinking: "off" },
				},
			}),
		);
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = globalRoot;
		try {
			const available = [
				{ provider: "anthropic", id: "fast", name: "fast" },
				{ provider: "anthropic", id: "deep", name: "deep" },
				{ provider: "openai-codex", id: "parent", name: "parent" },
			];
			const registry = {
				find: (provider: string, modelId: string) =>
					available.find((model) => model.provider === provider && model.id === modelId),
			};
			const parentModel = available[2] as any;

			const quick = resolveAgentProfile({
				registry,
				parentModel,
				config: DEFAULT_AGENTS.get("Explore"),
			});
			expect(quick.model).toMatchObject({ provider: "anthropic", id: "fast" });
			expect(quick.thinkingLevel).toBe("low");
			expect(quick.profile).toBe("quick");

			const overridden = resolveAgentProfile({
				registry,
				parentModel,
				config: DEFAULT_AGENTS.get("Explore"),
				explicitProfile: "deep",
			});
			expect(overridden.model).toMatchObject({ provider: "anthropic", id: "deep" });
			expect(overridden.thinkingLevel).toBe("xhigh");
			expect(overridden.profile).toBe("deep");

			const off = resolveAgentProfile({
				registry,
				config: DEFAULT_AGENTS.get("Explore"),
				explicitProfile: "background",
			});
			expect(off).toMatchObject({ model: available[0], thinking: "off", thinkingLevel: "off" });

			const inherited = resolveAgentProfile({ registry, parentModel, parentThinking: "off" });
			expect(inherited).toMatchObject({ model: parentModel, thinking: "off", thinkingLevel: "off" });

			const missing = resolveAgentProfile({ registry, config: { profile: "missing" } });
			expect(missing.model).toBeUndefined();
			expect(missing.error).toMatch(/model profile must be one of/);
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
		}
	});

	it("lets an explicit Model bypass a lower-priority routing error", () => {
		const explicitModel = { provider: "anthropic", id: "explicit" } as any;
		const selected = selectAgentModel(explicitModel, {
			model: undefined,
			error: 'Model not found: "openai-codex/does-not-exist"',
		});
		expect(selected).toBe(explicitModel);
		expect(() =>
			selectAgentModel(undefined, {
				model: undefined,
				error: "invalid configured model",
			}),
		).toThrow("invalid configured model");
	});

	it("keeps inference selection out of invocation lifecycle normalization", () => {
		const config = {
			name: "reviewer",
			description: "review",
			extensions: true,
			skills: true,
			systemPrompt: "review",
			promptMode: "replace",
			profile: "deep",
			maxTurns: 11,
		} satisfies AgentConfig;
		const resolved = resolveAgentInvocationConfig(config, {
			run_in_background: false,
			isolated: false,
			inherit_context: false,
			pair: false,
			system_prompt: "  Focus on the requested boundary.  ",
		});
		expect(resolved).toMatchObject({
			maxTurns: 11,
			systemPrompt: "Focus on the requested boundary.",
			inheritContext: false,
			pair: false,
			runInBackground: false,
			isolated: false,
		});
	});

	it("enables Pair only for write-capable default agents", () => {
		const pairDefaults = [...DEFAULT_AGENTS.values()].filter((config) => config.pair === true);
		expect(pairDefaults).not.toHaveLength(0);
		for (const config of pairDefaults) {
			const tools = config.builtinToolNames ?? BUILTIN_TOOL_NAMES;
			expect(
				tools.some((tool) => (tool === "edit" || tool === "write") && !config.disallowedTools?.includes(tool)),
			).toBe(true);
		}
	});

	it("uses agent Pair defaults while preserving explicit invocation overrides", () => {
		expect(resolveAgentInvocationConfig(DEFAULT_AGENTS.get("Implement"), {})).toMatchObject({ pair: true });
		expect(
			resolveAgentInvocationConfig(
				{
					name: "Implement",
					description: "Custom implementation agent",
					builtinToolNames: ["read", "edit"],
					extensions: false,
					skills: false,
					systemPrompt: "Implement the assigned task.",
					promptMode: "replace",
				},
				{},
			),
		).toMatchObject({ pair: true });
		expect(resolveAgentInvocationConfig({ ...DEFAULT_AGENTS.get("Implement")!, pair: false }, {})).toMatchObject({
			pair: false,
		});
		expect(resolveAgentInvocationConfig(DEFAULT_AGENTS.get("Explore"), {})).toMatchObject({ pair: false });
		expect(
			resolveAgentInvocationConfig(DEFAULT_AGENTS.get("Implement"), {
				run_in_background: false,
				isolated: false,
				inherit_context: false,
				pair: false,
			}),
		).toMatchObject({ inheritContext: false, pair: false });
		expect(
			resolveAgentInvocationConfig(DEFAULT_AGENTS.get("Implement"), {
				run_in_background: false,
				isolated: false,
				inherit_context: true,
				pair: true,
			}),
		).toMatchObject({ inheritContext: true, pair: true });
	});

	it("retains the full branch only for explicit inheritance", () => {
		const ctx = {
			sessionManager: {
				getBranch: () => [
					{ type: "message", message: { role: "user", content: [{ type: "text", text: "earlier decision" }] } },
					{ type: "message", message: { role: "user", content: [{ type: "text", text: "latest decision" }] } },
				],
			},
		} as any;
		expect(buildFullParentContext(ctx)).toContain("earlier decision");
	});

	it("stops queued result polling after its requested yield interval expires", async () => {
		vi.useFakeTimers();
		const record = { status: "queued" as const };
		const waiting = waitForAgentSettlement(record, { kind: "yield", seconds: 0.01 });
		await vi.advanceTimersByTimeAsync(10);
		expect(await waiting).toBe("yielded");
		await vi.advanceTimersByTimeAsync(50);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("reports that a yielded child continues working", async () => {
		const record = {
			id: "child-wait-timeout",
			parentAgentId: "parent-1",
			status: "running",
			promise: new Promise(() => {}),
		};
		const manager = { getRecord: vi.fn(() => record) };
		const tools = createNestedSubagentTools({
			manager: manager as any,
			pi: {} as any,
			parentAgentId: "parent-1",
			depth: 1,
			maxSubagentDepth: 2,
			allowedSubagents: "all",
			configCwd: process.cwd(),
			projectTrusted: false,
		});
		const resultTool = tools.find((tool) => tool.name === "get_subagent_result") as any;
		const result = await resultTool.execute(
			"check-child",
			{ agent_id: "child-wait-timeout", yield_seconds: 0.01 },
			undefined,
		);
		expect(result.content[0].text).toContain(
			"Yield interval (0.01s) reached; the child is still working in the background and was not stopped. Call get_subagent_result again only when you need another check-in.",
		);
	});

	it("waits for an owned nested child when yield_seconds is omitted", async () => {
		let settleChild: (() => void) | undefined;
		const record = {
			id: "child-indefinite-wait",
			parentAgentId: "parent-1",
			status: "running",
			promise: new Promise<void>((resolve) => {
				settleChild = resolve;
			}),
			result: undefined as string | undefined,
		};
		const manager = { getRecord: vi.fn(() => record) };
		const tools = createNestedSubagentTools({
			manager: manager as any,
			pi: {} as any,
			parentAgentId: "parent-1",
			depth: 1,
			maxSubagentDepth: 2,
			allowedSubagents: "all",
			configCwd: process.cwd(),
			projectTrusted: false,
		});
		const resultTool = tools.find((tool) => tool.name === "get_subagent_result") as any;
		let returned = false;
		const result = resultTool.execute("wait-for-child", { agent_id: record.id }, undefined).then((value: unknown) => {
			returned = true;
			return value as any;
		});
		await Promise.resolve();
		expect(returned).toBe(false);
		record.status = "completed";
		record.result = "NESTED-WAIT-DONE";
		settleChild?.();
		expect((await result).content[0].text).toContain("NESTED-WAIT-DONE");
	});

	it("rejects invalid wait values at the nested tool boundary", async () => {
		const getRecord = vi.fn();
		const tools = createNestedSubagentTools({
			manager: { getRecord } as any,
			pi: {} as any,
			parentAgentId: "parent-1",
			depth: 1,
			maxSubagentDepth: 2,
			allowedSubagents: "all",
			configCwd: process.cwd(),
			projectTrusted: false,
		});
		const resultTool = tools.find((tool) => tool.name === "get_subagent_result") as any;
		const result = await resultTool.execute(
			"invalid-wait",
			{ agent_id: "child", yield_seconds: Number.POSITIVE_INFINITY },
			undefined,
		);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("finite number greater than or equal to 0");
		expect(getRecord).not.toHaveBeenCalled();
	});

	it("distinguishes indefinite, immediate, transcript snapshot, and finite yield intervals", () => {
		expect(resolveResultWaitMode(undefined)).toEqual({ kind: "indefinite" });
		expect(resolveResultWaitMode(undefined, true)).toEqual({ kind: "immediate" });
		expect(resolveResultWaitMode(0)).toEqual({ kind: "immediate" });
		expect(resolveResultWaitMode(-0)).toEqual({ kind: "immediate" });
		expect(resolveResultWaitMode(1.9)).toEqual({ kind: "yield", seconds: 1.9 });
		expect(resolveResultWaitMode(301)).toEqual({ kind: "yield", seconds: 301 });
		for (const invalid of [-1, "1", Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
			expect(() => resolveResultWaitMode(invalid)).toThrow(/finite number greater than or equal to 0/);
		}
	});

	it("waits indefinitely across queued and running states without aborting the child", async () => {
		vi.useFakeTimers();
		let settleRun: (() => void) | undefined;
		const record: { status: "queued" | "running" | "completed"; promise?: Promise<void> } = { status: "queued" };
		const waiting = waitForAgentSettlement(record, { kind: "indefinite" });
		record.status = "running";
		record.promise = new Promise<void>((resolve) => {
			settleRun = resolve;
		});
		await vi.advanceTimersByTimeAsync(50);
		let finished = false;
		waiting.then(() => {
			finished = true;
		});
		await Promise.resolve();
		expect(finished).toBe(false);
		record.status = "completed";
		settleRun?.();
		expect(await waiting).toBe("settled");
	});

	it("accepts large yield intervals", async () => {
		vi.useFakeTimers();
		const record = { status: "running" as const, promise: new Promise<void>(() => {}) };
		const waiting = waitForAgentSettlement(record, { kind: "yield", seconds: 301 });
		let outcome: string | undefined;
		waiting.then((value) => {
			outcome = value;
		});
		await vi.advanceTimersByTimeAsync(300_000);
		expect(outcome).toBeUndefined();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(await waiting).toBe("yielded");
	});

	it("returns on settlement before a very large yield interval elapses", async () => {
		let settle: (() => void) | undefined;
		const record: { status: "running" | "completed"; promise: Promise<void> } = {
			status: "running",
			promise: new Promise<void>((resolve) => {
				settle = resolve;
			}),
		};
		const waiting = waitForAgentSettlement(record, { kind: "yield", seconds: 3_600 });
		record.status = "completed";
		settle?.();
		expect(await waiting).toBe("settled");
	});

	it("releases the caller abort listener when a yield interval expires", async () => {
		vi.useFakeTimers();
		const controller = new AbortController();
		const addListener = vi.spyOn(controller.signal, "addEventListener");
		const removeListener = vi.spyOn(controller.signal, "removeEventListener");
		const record = { status: "running" as const, promise: new Promise<void>(() => {}) };
		const waiting = waitForAgentSettlement(record, { kind: "yield", seconds: 0.01 }, controller.signal);
		await vi.advanceTimersByTimeAsync(10);
		expect(await waiting).toBe("yielded");
		expect(addListener).toHaveBeenCalledTimes(1);
		expect(removeListener).toHaveBeenCalledTimes(1);
	});

	it("caller cancellation stops only an indefinite result wait", async () => {
		const controller = new AbortController();
		const record = { status: "running" as const, promise: new Promise<void>(() => {}) };
		const waiting = waitForAgentSettlement(record, { kind: "indefinite" }, controller.signal);
		controller.abort(new Error("stop waiting"));
		await expect(waiting).rejects.toThrow("stop waiting");
		expect(record.status).toBe("running");
	});

	it("interrupts a result wait without stopping its agent", async () => {
		let interrupt!: () => void;
		const interrupted = new Promise<void>((resolve) => {
			interrupt = resolve;
		});
		const record = { status: "running" as const, promise: new Promise<void>(() => {}) };
		const waiting = waitForAgentSettlement(record, { kind: "indefinite" }, undefined, interrupted);
		interrupt();
		expect(await waiting).toBe("interrupted");
		expect(record.status).toBe("running");
	});

	it("requires explicit nested invocation choices and an optional uncapped yield interval", () => {
		const tools = createNestedSubagentTools({
			manager: {} as any,
			pi: {} as any,
			parentAgentId: "parent-1",
			depth: 0,
			maxSubagentDepth: 1,
			allowedSubagents: "all",
			configCwd: process.cwd(),
			projectTrusted: false,
		});
		const agentSchema = tools.find((tool) => tool.name === "Agent")!.parameters as any;
		const resultSchema = tools.find((tool) => tool.name === "get_subagent_result")!.parameters as any;
		expect(agentSchema.required).toEqual(expect.arrayContaining(["run_in_background", "isolated", "inherit_context"]));
		expect(agentSchema.required).not.toContain("pair");
		expect(agentSchema.properties.profile.anyOf.map((entry: any) => entry.const)).toEqual([
			"quick",
			"balanced",
			"pair",
			"deep",
			"coding",
			"visual-engineering",
			"background",
		]);
		expect(agentSchema.properties.profile.description).toContain("model/thinking only");
		expect(agentSchema.properties.system_prompt.description).toContain("appended after the selected definition");
		expect(agentSchema.properties.pair.description).toContain("definition's Pair default");
		expect(resultSchema.required).not.toContain("yield_seconds");
		expect(resultSchema.properties.yield_seconds.minimum).toBe(0);
		expect(resultSchema.properties.yield_seconds.description).toContain("very large positive value");
		expect(resultSchema.properties.yield_seconds.description).toContain("not a child timeout");
	});

	it("loads current orchestration settings", () => {
		const root = temporaryRoot();
		mkdirSync(join(root, ".pi"), { recursive: true });
		writeFileSync(
			join(root, ".pi", "subagents.json"),
			JSON.stringify({
				maxConcurrent: 7,
				persistAgentSessions: false,
				widgetMode: "all",
			}),
		);
		const settings = loadSettings({ cwd: root, projectTrusted: true }) as Record<string, unknown>;
		expect(settings).toMatchObject({ maxConcurrent: 7, persistAgentSessions: false, widgetMode: "all" });
	});

	it("ignores project subagent settings until the project is trusted", () => {
		const project = temporaryRoot();
		const agentDir = temporaryRoot();
		mkdirSync(join(project, ".pi"), { recursive: true });
		writeFileSync(join(project, ".pi", "subagents.json"), JSON.stringify({ maxConcurrent: 17 }));
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		try {
			expect(loadSettings({ cwd: project, projectTrusted: false }).maxConcurrent).toBeUndefined();
			expect(loadSettings({ cwd: project, projectTrusted: true }).maxConcurrent).toBe(17);
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
		}
	});

	it("bounds recent transcript snapshots while preserving their newest content", () => {
		const output = getAgentConversation(
			{
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: `OLDEST-${"x".repeat(TRANSCRIPT_TAIL_MAX_CHARS * 2)}-NEWEST` }],
					},
				],
				state: {},
			} as any,
			1,
		);
		expect(output.length).toBeLessThanOrEqual(TRANSCRIPT_TAIL_MAX_CHARS);
		expect(output).toContain("Earlier transcript content clipped");
		expect(output).toContain("[Assistant]: …");
		expect(output).toContain("-NEWEST");
		expect(output).not.toContain("OLDEST-");
	});

	it("passes the exact scoped config authorized by nested dispatch into the spawn", async () => {
		const root = temporaryRoot();
		mkdirSync(join(root, ".pi", "agents"), { recursive: true });
		writeFileSync(
			join(root, ".pi", "agents", "snapshot.md"),
			"---\nname: snapshot-agent\ndescription: Scoped snapshot role\ntools: read\nskills: false\n---\n\nUse the authorized scoped role.\n",
		);
		const spawn = vi.fn(() => "child-1");
		const tools = createNestedSubagentTools({
			manager: { spawn } as any,
			pi: {} as any,
			parentAgentId: "parent-1",
			depth: 1,
			maxSubagentDepth: 2,
			allowedSubagents: "all",
			configCwd: root,
			projectTrusted: true,
		});
		const agentTool = tools.find((tool) => tool.name === "Agent") as any;
		const result = await agentTool.execute(
			"spawn-child",
			{
				prompt: "Run the scoped task.",
				description: "Scoped child",
				subagent_type: "snapshot-agent",
				system_prompt: "Inspect only the requested files.",
				run_in_background: true,
				isolated: false,
				inherit_context: false,
			},
			undefined,
			undefined,
			{
				model: { provider: "xai", id: "parent-model" },
				thinkingLevel: "high",
				modelRegistry: { find: vi.fn() },
			} as any,
		);
		expect(result.isError).not.toBe(true);
		expect(result.content[0].text).toContain(
			"Call get_subagent_result with this agent_id to wait for its final result.",
		);
		expect(spawn).toHaveBeenCalledOnce();
		const options = spawn.mock.calls[0]?.[4] as any;
		expect(options.agentConfig).toMatchObject({
			name: "snapshot-agent",
			description: "Scoped snapshot role",
			builtinToolNames: ["read"],
			skills: false,
			systemPrompt: "Use the authorized scoped role.",
		});
		expect(options.systemPrompt).toBe("Inspect only the requested files.");
		expect(options.invocation.systemPrompt).toBe("Inspect only the requested files.");
	});

	it("lets a nested orchestrator inspect a running child's recent transcript without waiting", async () => {
		const record = {
			id: "child-1",
			type: "Explore",
			description: "inspect",
			status: "running",
			toolUses: 0,
			startedAt: Date.now(),
			lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
			compactionCount: 0,
			parentAgentId: "parent-1",
			session: {
				messages: [
					{ role: "user", content: "old direction" },
					{ role: "assistant", content: [{ type: "text", text: "old progress" }] },
					{ role: "user", content: "latest direction" },
				],
				state: {
					streamingMessage: { role: "assistant", content: [{ type: "text", text: "live partial progress" }] },
				},
			},
		};
		const manager = { getRecord: vi.fn(() => record) };
		const tools = createNestedSubagentTools({
			manager: manager as any,
			pi: {} as any,
			parentAgentId: "parent-1",
			depth: 1,
			maxSubagentDepth: 2,
			allowedSubagents: "all",
			configCwd: process.cwd(),
			projectTrusted: false,
		});
		const resultTool = tools.find((tool) => tool.name === "get_subagent_result") as any;
		const result = await resultTool.execute(
			"check-child",
			{
				agent_id: "child-1",
				transcript_tail: 2,
			},
			undefined,
		);
		const output = result.content[0].text as string;
		expect(output).toContain("Agent child-1 is running.");
		expect(output).toContain("latest direction");
		expect(output).toContain("live partial progress");
		expect(output).not.toContain("old direction");
		expect(output).not.toContain("old progress");

		(record as any).status = "completed";
		(record as any).result = "FULL-FINAL-RESULT-MUST-NOT-LEAK-INTO-A-TAIL-CHECK";
		const settledResult = await resultTool.execute(
			"check-settled-child",
			{
				agent_id: "child-1",
				transcript_tail: 2,
			},
			undefined,
		);
		const settledOutput = settledResult.content[0].text as string;
		expect(settledOutput).toContain("Agent child-1 is completed.");
		expect(settledOutput).not.toContain("FULL-FINAL-RESULT-MUST-NOT-LEAK-INTO-A-TAIL-CHECK");

		const fullOutput = "x".repeat(75_000);
		(record as any).result = fullOutput;
		const fullResult = await resultTool.execute("get-settled-child", { agent_id: "child-1" }, undefined);
		expect(fullResult.content[0].text).toContain(fullOutput);
	});

	it("lets a nested orchestrator stop only a running child it owns", async () => {
		const owned = {
			id: "owned-child",
			parentAgentId: "parent-1",
			status: "running",
		};
		const foreign = {
			id: "foreign-child",
			parentAgentId: "parent-2",
			status: "running",
		};
		const records = new Map([
			[owned.id, owned],
			[foreign.id, foreign],
		]);
		const manager = {
			getRecord: vi.fn((id: string) => records.get(id)),
			abort: vi.fn((id: string) => {
				const record = records.get(id);
				if (!record || (record.status !== "running" && record.status !== "queued")) return false;
				record.status = "stopped";
				return true;
			}),
		};
		const tools = createNestedSubagentTools({
			manager: manager as any,
			pi: {} as any,
			parentAgentId: "parent-1",
			depth: 1,
			maxSubagentDepth: 2,
			allowedSubagents: "all",
			configCwd: process.cwd(),
			projectTrusted: false,
		});
		const stopTool = tools.find((tool) => tool.name === "stop_subagent") as any;

		const stopped = await stopTool.execute("stop-owned", { agent_id: owned.id });
		expect(stopped.isError).toBe(false);
		expect(stopped.content[0].text).toBe(`Stopped nested agent ${owned.id}.`);
		expect(owned.status).toBe("stopped");

		const stoppedAgain = await stopTool.execute("stop-settled", { agent_id: owned.id });
		expect(stoppedAgain.isError).toBe(true);
		const foreignStop = await stopTool.execute("stop-foreign", { agent_id: foreign.id });
		expect(foreignStop.isError).toBe(true);
		expect(manager.abort).toHaveBeenCalledTimes(2);
		expect(manager.abort).not.toHaveBeenCalledWith(foreign.id);
	});

	it("applies and persists the child-session authority setting", () => {
		const root = temporaryRoot();
		let persistent = true;
		const settings = { persistAgentSessions: false, maxConcurrent: 5 };
		expect(saveSettings(settings, root)).toBe(true);
		applySettings(loadSettings({ cwd: root, projectTrusted: true }), {
			setMaxConcurrent: () => {},
			setDefaultMaxTurns: () => {},
			setGraceTurns: () => {},
			setDefaultJoinMode: () => {},
			setStrictAgentFiles: () => {},
			setDisableDefaultAgents: () => {},
			setFleetView: () => {},
			setPersistAgentSessions: (value) => {
				persistent = value;
			},
			setWidgetMode: () => {},
			setMaxSubagentDepth: () => {},
		});
		expect(persistent).toBe(false);
	});
});

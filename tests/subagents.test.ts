import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForAgentSettlement } from "../components/subagents/src/abortable.js";
import { getAgentConversation, TRANSCRIPT_TAIL_MAX_CHARS } from "../components/subagents/src/conversation.js";
import { buildCompactParentHandoff, buildFullParentContext, MAX_PARENT_HANDOFF_CHARS } from "../components/subagents/src/context.js";
import { DEFAULT_AGENTS } from "../components/subagents/src/default-agents.js";
import { resolveAgentInvocationConfig } from "../components/subagents/src/invocation-config.js";
import { selectAgentModel } from "../components/subagents/src/agent-runner.js";
import { createNestedSubagentTools } from "../components/subagents/src/nested-tools.js";
import { loadCustomAgents } from "../components/subagents/src/custom-agents.js";
import { resolveAgentModel } from "../components/subagents/src/model-routing.js";
import { applySettings, loadSettings, saveSettings } from "../components/subagents/src/settings.js";
import type { AgentConfig } from "../components/subagents/src/types.js";

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
	it("uses Luna for the built-in read-only explorer", () => {
		expect(DEFAULT_AGENTS.get("Explore")).toMatchObject({
			model: "openai-codex/gpt-5.6-luna",
			thinking: "medium",
		});
	});

	it("routes built-in agent models through modes.json and keeps custom frontmatter highest precedence", async () => {
		const root = temporaryRoot();
		const globalRoot = join(root, "pi-agent");
		mkdirSync(globalRoot, { recursive: true });
		writeFileSync(join(globalRoot, "modes.json"), JSON.stringify({
			modes: {
				explore: { provider: "anthropic", modelId: "route-explore", thinkingLevel: "high" },
				plan: { provider: "anthropic", modelId: "route-plan", thinkingLevel: "xhigh" },
				"general-purpose": { thinkingLevel: "low" },
			},
		}));
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = globalRoot;
		try {
			const registry = {
				find: (provider: string, modelId: string) => {
					const match = available.find((m) => m.provider === provider && m.id === modelId);
					return match ?? undefined;
				},
				getAvailable: () => available,
			};
			const available = [
				{ provider: "anthropic", id: "route-explore", name: "route-explore" },
				{ provider: "anthropic", id: "route-plan", name: "route-plan" },
				{ provider: "anthropic", id: "explicit", name: "explicit" },
				{ provider: "openai-codex", id: "custom-frontmatter", name: "custom-frontmatter" },
				{ provider: "openai-codex", id: "parent-model", name: "parent-model" },
			];
			const parentModel = { provider: "openai-codex", id: "parent-model" } as any;

			const route = await resolveAgentModel({
				cwd: root,
				projectTrusted: false,
				registry,
				parentModel,
				config: DEFAULT_AGENTS.get("Explore"),
				type: "Explore",
			});
			expect(route.model).toMatchObject({ provider: "anthropic", id: "route-explore" });
			expect(route.thinkingLevel).toBe("high");

			const plan = await resolveAgentModel({
				cwd: root,
				projectTrusted: false,
				registry,
				parentModel,
				config: DEFAULT_AGENTS.get("Plan"),
				type: "Plan",
			});
			expect(plan.model).toMatchObject({ provider: "anthropic", id: "route-plan" });
			expect(plan.thinkingLevel).toBe("xhigh");

			const custom = await resolveAgentModel({
				cwd: root,
				projectTrusted: false,
				registry,
				parentModel,
				config: { ...DEFAULT_AGENTS.get("Explore")!, isDefault: false, model: "openai-codex/custom-frontmatter" },
				type: "Explore",
			});
			expect(custom.model).toMatchObject({ provider: "openai-codex", id: "custom-frontmatter" });
			expect(custom.thinkingLevel).toBe("medium");

			const explicit = await resolveAgentModel({
				cwd: root,
				projectTrusted: false,
				registry,
				parentModel,
				config: DEFAULT_AGENTS.get("Explore"),
				type: "Explore",
				explicitModel: "anthropic/explicit",
			});
			expect(explicit.model).toMatchObject({ provider: "anthropic", id: "explicit" });

			const generalPurpose = await resolveAgentModel({
				cwd: root,
				projectTrusted: false,
				registry,
				parentModel,
				config: DEFAULT_AGENTS.get("general-purpose"),
				type: "general-purpose",
			});
			expect(generalPurpose.model).toBe(parentModel);
			expect(generalPurpose.thinkingLevel).toBe("low");

			const embeddedFallback = await resolveAgentModel({
				cwd: root,
				projectTrusted: false,
				registry,
				parentModel,
				config: DEFAULT_AGENTS.get("Plan"),
				type: "unrouted-built-in",
			});
			expect(embeddedFallback.model).toBe(parentModel);
			expect(embeddedFallback.error).toBeUndefined();

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
		expect(() => selectAgentModel(undefined, {
			model: undefined,
			error: "invalid configured model",
		})).toThrow("invalid configured model");
	});

	it("fails closed on removed memory, transcript, scheduling, and worktree fields", () => {
		const root = temporaryRoot();
		const directory = join(root, ".pi", "agents");
		mkdirSync(directory, { recursive: true });
		writeFileSync(join(directory, "reviewer.md"), `---
name: reviewer
description: Reviews a change
tools: read, grep
allowed_subagents: scout
memory: project
isolation: worktree
output_transcript: true
---
Review carefully.
`);

		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		const agents = loadCustomAgents(root);
		expect(agents.has("reviewer")).toBe(false);
		expect(warning).toHaveBeenCalledWith(expect.stringContaining("removed apple-pi fields isolation, memory, output_transcript"));
		warning.mockRestore();
	});

	it("keeps explicit thinking overrides while preserving config policy fields", () => {
		const config = {
			name: "reviewer",
			description: "review",
			extensions: true,
			skills: true,
			systemPrompt: "review",
			promptMode: "replace",
			model: "openai-codex/embedded",
			thinking: "low" as const,
			maxTurns: 11,
			inheritContext: false,
			runInBackground: false,
			isolated: false,
		} satisfies AgentConfig;
		const resolved = resolveAgentInvocationConfig(config, {
			thinking: "high",
			max_turns: 8,
			run_in_background: true,
			isolated: true,
		});
		expect(resolved).toMatchObject({
			thinking: "high",
			maxTurns: 11,
			inheritContext: false,
			runInBackground: false,
			isolated: false,
		});
		expect(resolved).not.toHaveProperty("isolation");
	});

	it("uses a bounded parent handoff by default while trusted definitions retain full and no-context modes", () => {
		expect(resolveAgentInvocationConfig(DEFAULT_AGENTS.get("general-purpose"), {}).inheritContext).toBeUndefined();
		expect(resolveAgentInvocationConfig({ ...DEFAULT_AGENTS.get("general-purpose")!, inheritContext: true }, {}).inheritContext).toBe(true);
		expect(resolveAgentInvocationConfig(DEFAULT_AGENTS.get("Explore"), {}).inheritContext).toBe(false);
	});

	it("keeps only recent decision context in an inherited handoff", () => {
		const handoff = buildCompactParentHandoff({
			sessionManager: {
				getBranch: () => [
					{ type: "message", message: { role: "user", content: [{ type: "text", text: "old request must not survive" }] } },
					{ type: "compaction", summary: `latest summary ${"s".repeat(MAX_PARENT_HANDOFF_CHARS)}` },
					{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "latest assistant report" }] } },
					{ type: "message", message: { role: "user", content: [{ type: "text", text: "latest user request" }] } },
				],
			},
		} as any);

		expect(handoff).toContain("# Parent Handoff");
		expect(handoff).toContain("latest summary");
		expect(handoff).toContain("latest user request");
		expect(handoff).toContain("latest assistant report");
		expect(handoff).not.toContain("old request must not survive");
		expect(handoff.length).toBeLessThanOrEqual(MAX_PARENT_HANDOFF_CHARS + 300);
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
		expect(buildCompactParentHandoff(ctx)).not.toContain("earlier decision");
		expect(buildFullParentContext(ctx)).toContain("earlier decision");
	});

	it("stops queued result polling after its bounded wait expires", async () => {
		vi.useFakeTimers();
		const record = { status: "queued" as const };
		const waiting = waitForAgentSettlement(record, undefined, 10);
		await vi.advanceTimersByTimeAsync(10);
		expect(await waiting).toBe(false);
		await vi.advanceTimersByTimeAsync(50);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("parses continuous advisor as explicit custom-agent opt-in", () => {
		const root = temporaryRoot();
		const directory = join(root, ".pi", "agents");
		mkdirSync(directory, { recursive: true });
		writeFileSync(join(directory, "deep-implementation.md"), `---
name: deep-implementation
description: correctness-critical implementation
advisor: true
---
Implement carefully.
`);

		expect(loadCustomAgents(root).get("deep-implementation")?.advisor).toBe(true);
		expect(DEFAULT_AGENTS.get("general-purpose")?.advisor).toBeUndefined();
	});

	it("sanitizes settings to the retained orchestration controls", () => {
		const root = temporaryRoot();
		mkdirSync(join(root, ".pi"), { recursive: true });
		writeFileSync(join(root, ".pi", "subagents.json"), JSON.stringify({
			maxConcurrent: 7,
			persistAgentSessions: false,
			widgetMode: "all",
			schedulingEnabled: true,
			agentMentions: "model",
			outputTranscript: true,
		}));
		const settings = loadSettings(root) as Record<string, unknown>;
		expect(settings).toMatchObject({ maxConcurrent: 7, persistAgentSessions: false, widgetMode: "all" });
		expect(settings).not.toHaveProperty("schedulingEnabled");
		expect(settings).not.toHaveProperty("agentMentions");
		expect(settings).not.toHaveProperty("outputTranscript");
	});

	it("bounds recent transcript snapshots while preserving their newest content", () => {
		const output = getAgentConversation({
			messages: [{
				role: "assistant",
				content: [{ type: "text", text: `OLDEST-${"x".repeat(TRANSCRIPT_TAIL_MAX_CHARS * 2)}-NEWEST` }],
			}],
			state: {},
		} as any, 1);
		expect(output.length).toBeLessThanOrEqual(TRANSCRIPT_TAIL_MAX_CHARS);
		expect(output).toContain("Earlier transcript content clipped");
		expect(output).toContain("[Assistant]: …");
		expect(output).toContain("-NEWEST");
		expect(output).not.toContain("OLDEST-");
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
		});
		const resultTool = tools.find((tool) => tool.name === "get_subagent_result") as any;
		const result = await resultTool.execute("check-child", {
			agent_id: "child-1",
			transcript_tail: 2,
		}, undefined);
		const output = result.content[0].text as string;
		expect(output).toContain("Agent child-1 is running.");
		expect(output).toContain("latest direction");
		expect(output).toContain("live partial progress");
		expect(output).not.toContain("old direction");
		expect(output).not.toContain("old progress");

		(record as any).status = "completed";
		(record as any).result = "FULL-FINAL-RESULT-MUST-NOT-LEAK-INTO-A-TAIL-CHECK";
		const settledResult = await resultTool.execute("check-settled-child", {
			agent_id: "child-1",
			transcript_tail: 2,
		}, undefined);
		const settledOutput = settledResult.content[0].text as string;
		expect(settledOutput).toContain("Agent child-1 is completed.");
		expect(settledOutput).not.toContain("FULL-FINAL-RESULT-MUST-NOT-LEAK-INTO-A-TAIL-CHECK");
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
		const records = new Map([[owned.id, owned], [foreign.id, foreign]]);
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
		applySettings(loadSettings(root), {
			setMaxConcurrent: () => {},
			setDefaultMaxTurns: () => {},
			setGraceTurns: () => {},
			setDefaultJoinMode: () => {},
			setStrictAgentFiles: () => {},
			setDisableDefaultAgents: () => {},
			setFleetView: () => {},
			setPersistAgentSessions: (value) => { persistent = value; },
			setWidgetMode: () => {},
			setMaxSubagentDepth: () => {},
			setFallbackSubagent: () => {},
		});
		expect(persistent).toBe(false);
	});
});

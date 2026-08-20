import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_SUBAGENT_RESULT_WAIT_SECONDS,
	MAX_SUBAGENT_RESULT_WAIT_SECONDS,
	normalizeWaitSeconds,
	waitForAgentSettlement,
} from "../src/abortable.js";
import { selectAgentModel } from "../src/agent-runner.js";
import { buildAgentRegistry, getToolNamesForType, resolveSpawnTypeIn } from "../src/agent-types.js";
import { buildFullParentContext } from "../src/context.js";
import { getAgentConversation, TRANSCRIPT_TAIL_MAX_CHARS } from "../src/conversation.js";
import { loadCustomAgents } from "../src/custom-agents.js";
import { DEFAULT_AGENTS } from "../src/default-agents.js";
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

	it("registers the specialist catalog as built-ins with lane-specific tools", () => {
		expect([...DEFAULT_AGENTS.keys()]).toEqual([...DEFAULT_AGENT_NAMES]);
		expect(DEFAULT_AGENTS.get("Research")).toMatchObject({
			profile: "quick",
			builtinToolNames: ["read", "bash", "grep", "find", "ls"],
			extensions: false,
			skills: false,
			promptMode: "replace",
		});
		expect(DEFAULT_AGENTS.get("Counsel")).toMatchObject({
			profile: "deep",
			builtinToolNames: ["read", "bash", "grep", "find", "ls"],
			promptMode: "replace",
		});
		expect(DEFAULT_AGENTS.get("Implement")).toMatchObject({
			profile: "coding",
			advisor: true,
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
		expect(DEFAULT_AGENTS.get("Counsel")?.systemPrompt).toMatch(/You advise; you do not implement/);
		expect(DEFAULT_AGENTS.get("Implement")?.systemPrompt).toMatch(/that is Design/);
		expect(DEFAULT_AGENTS.get("Design")?.systemPrompt).toMatch(/refuse it/);
		expect(DEFAULT_AGENTS.has("general-purpose")).toBe(false);
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

	it("allows a Markdown definition to create an ordinary custom general-purpose type", () => {
		const root = temporaryRoot();
		const agentDir = temporaryRoot();
		mkdirSync(join(root, ".pi", "agents"), { recursive: true });
		writeFileSync(
			join(root, ".pi", "agents", "custom-general.md"),
			"---\nname: general-purpose\ndescription: Project-defined agent\ntools: read, edit\nprofile: coding\nadvisor: true\n---\n\nFollow the project contract.\n",
		);
		mkdirSync(join(agentDir, "agents"), { recursive: true });
		writeFileSync(
			join(agentDir, "agents", "global-safe.md"),
			"---\nname: global-safe\ndescription: User-owned global agent\n---\n\nGlobal role.\n",
		);
		const previous = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		try {
			const registry = buildAgentRegistry(loadCustomAgents({ cwd: root, projectTrusted: true }));
			expect(resolveSpawnTypeIn(registry, "general-purpose")).toEqual({ ok: true, type: "general-purpose" });
			const untrusted = buildAgentRegistry(loadCustomAgents({ cwd: root, projectTrusted: false }));
			expect(resolveSpawnTypeIn(untrusted, "general-purpose").ok).toBe(false);
			expect(resolveSpawnTypeIn(untrusted, "global-safe")).toEqual({ ok: true, type: "global-safe" });
			expect(registry.get("general-purpose")).toMatchObject({
				profile: "coding",
				advisor: true,
				builtinToolNames: ["read", "edit"],
			});
			expect(registry.get("general-purpose")?.isDefault).toBeUndefined();
		} finally {
			if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previous;
		}
	});

	it("rejects raw model and thinking fields in custom agent definitions", () => {
		const root = temporaryRoot();
		mkdirSync(join(root, ".pi", "agents"), { recursive: true });
		writeFileSync(
			join(root, ".pi", "agents", "raw-model.md"),
			"---\nname: raw-model\ndescription: Invalid raw route\nmodel: xai/direct\nthinking: high\n---\n\nInvalid role.\n",
		);
		expect(() => loadCustomAgents({ cwd: root, projectTrusted: true }, true)).toThrow(/raw model\/thinking fields/);
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
					silent: { model: "anthropic/fast", thinking: "off" },
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

			const off = resolveAgentProfile({ registry, config: DEFAULT_AGENTS.get("Explore"), explicitProfile: "silent" });
			expect(off).toMatchObject({ model: available[0], thinking: "off", thinkingLevel: "off" });

			const inherited = resolveAgentProfile({ registry, parentModel, parentThinking: "off" });
			expect(inherited).toMatchObject({ model: parentModel, thinking: "off", thinkingLevel: "off" });

			const missing = resolveAgentProfile({ registry, config: { profile: "missing" } });
			expect(missing.model).toBeUndefined();
			expect(missing.error).toMatch(/profile "missing" is not defined/);
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
			advisor: false,
		});
		expect(resolved).toMatchObject({
			maxTurns: 11,
			inheritContext: false,
			advisor: false,
			runInBackground: false,
			isolated: false,
		});
		expect(resolved).not.toHaveProperty("thinking");
	});

	it("uses agent Advisor defaults while preserving explicit invocation overrides", () => {
		expect(resolveAgentInvocationConfig(DEFAULT_AGENTS.get("Implement"), {})).toMatchObject({ advisor: true });
		expect(resolveAgentInvocationConfig(DEFAULT_AGENTS.get("Explore"), {})).toMatchObject({ advisor: false });
		expect(
			resolveAgentInvocationConfig(DEFAULT_AGENTS.get("Implement"), {
				run_in_background: false,
				isolated: false,
				inherit_context: false,
				advisor: false,
			}),
		).toMatchObject({ inheritContext: false, advisor: false });
		expect(
			resolveAgentInvocationConfig(DEFAULT_AGENTS.get("Implement"), {
				run_in_background: false,
				isolated: false,
				inherit_context: true,
				advisor: true,
			}),
		).toMatchObject({ inheritContext: true, advisor: true });
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

	it("stops queued result polling after its bounded wait expires", async () => {
		vi.useFakeTimers();
		const record = { status: "queued" as const };
		const waiting = waitForAgentSettlement(record, 10);
		await vi.advanceTimersByTimeAsync(10);
		expect(await waiting).toBe(false);
		await vi.advanceTimersByTimeAsync(50);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("formats timeout output with instructions to call get_subagent_result again", async () => {
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
			{ agent_id: "child-wait-timeout", wait_seconds: 1 },
			undefined,
		);
		expect(result.content[0].text).toContain(
			"Wait limit (1s) reached; it continues in the background. Please call get_subagent_result again to continue waiting.",
		);
	});

	it("defaults result checks to five minutes and clamps model-selected waits", () => {
		expect(normalizeWaitSeconds(undefined)).toBe(DEFAULT_SUBAGENT_RESULT_WAIT_SECONDS);
		expect(normalizeWaitSeconds(-1)).toBe(0);
		expect(normalizeWaitSeconds(1.9)).toBe(1);
		expect(normalizeWaitSeconds(MAX_SUBAGENT_RESULT_WAIT_SECONDS + 1)).toBe(MAX_SUBAGENT_RESULT_WAIT_SECONDS);
	});

	it("requires explicit nested invocation choices and a bounded wait duration", () => {
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
		expect(agentSchema.required).not.toContain("advisor");
		expect(agentSchema.properties.profile.description).toContain("model/thinking only");
		expect(agentSchema.properties).not.toHaveProperty("model");
		expect(agentSchema.properties).not.toHaveProperty("thinking");
		expect(agentSchema.properties.advisor.description).toContain("definition's Advisor default");
		expect(resultSchema.required).not.toContain("wait_seconds");
		expect(resultSchema.properties.wait_seconds.maximum).toBe(MAX_SUBAGENT_RESULT_WAIT_SECONDS);
		expect(resultSchema.properties.wait_seconds.description).toContain(
			`Omit to wait ${DEFAULT_SUBAGENT_RESULT_WAIT_SECONDS} seconds`,
		);
	});

	it("sanitizes settings to the retained orchestration controls", () => {
		const root = temporaryRoot();
		mkdirSync(join(root, ".pi"), { recursive: true });
		writeFileSync(
			join(root, ".pi", "subagents.json"),
			JSON.stringify({
				maxConcurrent: 7,
				persistAgentSessions: false,
				widgetMode: "all",
				schedulingEnabled: true,
				agentMentions: "model",
				outputTranscript: true,
				fallbackSubagent: "Implement",
			}),
		);
		const settings = loadSettings({ cwd: root, projectTrusted: true }) as Record<string, unknown>;
		expect(settings).toMatchObject({ maxConcurrent: 7, persistAgentSessions: false, widgetMode: "all" });
		expect(settings).not.toHaveProperty("schedulingEnabled");
		expect(settings).not.toHaveProperty("agentMentions");
		expect(settings).not.toHaveProperty("outputTranscript");
		expect(settings).not.toHaveProperty("fallbackSubagent");
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

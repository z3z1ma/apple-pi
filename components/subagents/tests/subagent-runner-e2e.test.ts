import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import installSubagents from "../src/index.js";
import { runAgent, SUBAGENT_TOOL_NAMES } from "../src/agent-runner.js";
import { registerAgents } from "../src/agent-types.js";
import { getManagedSubagentService } from "../src/service.js";
import type { AgentConfig } from "../src/types.js";
import { fauxModelBackend } from "../../../tests/helpers/faux-model.js";

const temporaryDirectories: string[] = [];
const fauxProviders: Array<{ unregister(): void }> = [];
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const isolatedAgentDir = mkdtempSync(join(tmpdir(), "apple-pi-e2e-agent-"));
process.env.PI_CODING_AGENT_DIR = isolatedAgentDir;
const CHILD_EXTENSION_TOOLS = ["ledger_add", "ledger_close", "vcc_recall", "mcp"];
const FORBIDDEN_CHILD_TOOLS = ["recall", "pi_exec", ...Object.values(SUBAGENT_TOOL_NAMES)];

function expectActiveTools(actual: string[], expected: string[]): void {
	for (const name of [...expected, ...CHILD_EXTENSION_TOOLS]) {
		expect(actual).toContain(name);
	}
	for (const name of FORBIDDEN_CHILD_TOOLS) {
		if (!expected.includes(name)) expect(actual).not.toContain(name);
	}
}

afterEach(() => {
	for (const provider of fauxProviders.splice(0)) provider.unregister();
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
	delete process.env.PI_VCC_CONFIG_PATH;
});

afterAll(() => {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(isolatedAgentDir, { recursive: true, force: true });
});

describe("subagent runner with Pi's real AgentSession", () => {
	it("runs a Markdown-style agent and returns its final answer", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "apple-pi-agent-e2e-"));
		temporaryDirectories.push(cwd);
		const faux = registerFauxProvider({ provider: "faux", models: [{ id: "faux-1", contextWindow: 200_000 }] });
		fauxProviders.push(faux);
		faux.setResponses([() => fauxAssistantMessage([fauxText("SUBAGENT-OK")])]);
		const model = faux.getModel();
		const runtime = fauxModelBackend(model);

		registerAgents(
			new Map<string, AgentConfig>([
				[
					"test-agent",
					{
						name: "test-agent",
						description: "test",
						builtinToolNames: ["read"],
						extensions: false,
						skills: false,
						persistSession: false,
						systemPrompt: "Answer the task.",
						promptMode: "replace",
					},
				],
			]),
		);

		let activeTools: string[] = [];
		const result = await runAgent(
			{
				cwd,
				model,
				modelRegistry: runtime.modelRegistry,
				getSystemPrompt: () => "parent",
				sessionManager: { getSessionFile: () => undefined },
			} as any,
			"test-agent",
			"answer now",
			{
				pi: { exec: async () => ({ code: 1, stdout: "", stderr: "" }) } as any,
				model,
				onSessionCreated: (session) => {
					activeTools = session.getActiveToolNames();
				},
			},
		);

		expect(result.responseText).toBe("SUBAGENT-OK");
		expect(result.failure).toBeUndefined();
		expectActiveTools(activeTools, ["read"]);
		result.session.dispose();
	}, 30_000);

	it("reports a clean terminal turn without text as a failure", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "apple-pi-agent-empty-stop-"));
		temporaryDirectories.push(cwd);
		const faux = registerFauxProvider({
			provider: "faux",
			models: [{ id: "faux-empty-stop", contextWindow: 200_000 }],
		});
		fauxProviders.push(faux);
		faux.setResponses([() => fauxAssistantMessage([fauxText("")])]);
		const model = faux.getModel();
		const runtime = fauxModelBackend(model);

		const result = await runAgent(
			{
				cwd,
				model,
				modelRegistry: runtime.modelRegistry,
				getSystemPrompt: () => "parent",
				sessionManager: { getSessionFile: () => undefined },
			} as any,
			"empty-stop",
			"answer",
			{
				pi: { exec: async () => ({ code: 1, stdout: "", stderr: "" }) } as any,
				model,
				agentConfig: {
					name: "empty-stop",
					description: "test",
					builtinToolNames: ["read"],
					extensions: false,
					skills: false,
					persistSession: false,
					systemPrompt: "Answer.",
					promptMode: "replace",
				},
			},
		);

		expect(result.responseText).toBe("");
		expect(result.failure).toBe("run ended without producing any text");
		result.session.dispose();
	}, 30_000);

	it("admits a controller-supplied typed tool in an extensionless session", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "apple-pi-agent-custom-tool-"));
		temporaryDirectories.push(cwd);
		const faux = registerFauxProvider({
			provider: "faux",
			models: [{ id: "faux-custom-tool", contextWindow: 200_000 }],
		});
		fauxProviders.push(faux);
		faux.setResponses([
			() => fauxAssistantMessage([fauxToolCall("submit_result", { value: "accepted" })], { stopReason: "toolUse" }),
		]);
		const model = faux.getModel();
		const runtime = fauxModelBackend(model);
		let submitted: string | undefined;
		let activeTools: string[] = [];
		const result = await runAgent(
			{
				cwd,
				model,
				modelRegistry: runtime.modelRegistry,
				getSystemPrompt: () => "parent",
				sessionManager: { getSessionFile: () => undefined },
			} as any,
			"extensionless-role",
			"submit",
			{
				pi: { exec: async () => ({ code: 1, stdout: "", stderr: "" }) } as any,
				model,
				agentConfig: {
					name: "extensionless-role",
					description: "test",
					builtinToolNames: ["read"],
					extensions: false,
					skills: false,
					persistSession: false,
					systemPrompt: "Submit the result.",
					promptMode: "replace",
				},
				customTools: [
					defineTool({
						name: "submit_result",
						label: "Submit result",
						description: "Submit the typed result.",
						parameters: Type.Object({ value: Type.String() }),
						async execute(_id, params) {
							submitted = params.value;
							return { content: [{ type: "text", text: "submitted" }], terminate: true };
						},
					}),
				],
				onSessionCreated: (session) => {
					activeTools = session.getActiveToolNames();
				},
			},
		);
		expect(submitted).toBe("accepted");
		expectActiveTools(activeTools, ["read", "submit_result"]);
		result.session.dispose();
	}, 30_000);

	it("honors an internal exact role profile and layers its tool policy before execution", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "apple-pi-agent-profile-"));
		temporaryDirectories.push(cwd);
		const faux = registerFauxProvider({ provider: "faux", models: [{ id: "faux-profile", contextWindow: 200_000 }] });
		fauxProviders.push(faux);
		faux.setResponses([
			() => fauxAssistantMessage([fauxToolCall("ls", { path: "." })], { stopReason: "toolUse" }),
			() => fauxAssistantMessage([fauxText("POLICY-OK")]),
		]);
		const model = faux.getModel();
		const runtime = fauxModelBackend(model);
		const policyCalls: string[] = [];
		let activeTools: string[] = [];
		const exactConfig: AgentConfig = {
			name: "internal-role",
			description: "exact internal role",
			builtinToolNames: ["ls"],
			extensions: false,
			skills: false,
			persistSession: false,
			systemPrompt: "Use the exact role.",
			promptMode: "replace",
		};
		const result = await runAgent(
			{
				cwd,
				model,
				modelRegistry: runtime.modelRegistry,
				getSystemPrompt: () => "parent",
				sessionManager: { getSessionFile: () => undefined },
			} as any,
			"internal-role",
			"list now",
			{
				pi: { exec: async () => ({ code: 1, stdout: "", stderr: "" }) } as any,
				model,
				agentConfig: exactConfig,
				toolPolicy: ({ toolName }) => {
					policyCalls.push(toolName);
					return { block: true, reason: "blocked by test" };
				},
				onSessionCreated: (session) => {
					activeTools = session.getActiveToolNames();
				},
			},
		);
		expect(result.responseText).toBe("POLICY-OK");
		expectActiveTools(activeTools, ["ls"]);
		expect(policyCalls).toEqual(["ls"]);
		result.session.dispose();
	}, 30_000);

	it("resumes a completed public Agent with its model-visible ID and prior context", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "apple-pi-agent-tool-"));
		temporaryDirectories.push(cwd);
		mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "agents", "tool-test.md"),
			`---
name: tool-test
description: public tool test
tools: read
extensions: false
skills: false
persist_session: false
---
Answer the task.
`,
		);
		writeFileSync(join(cwd, ".pi", "subagents.json"), JSON.stringify({ maxConcurrent: 1 }));
		const faux = registerFauxProvider({ provider: "faux", models: [{ id: "faux-tool", contextWindow: 200_000 }] });
		fauxProviders.push(faux);
		let resumedContext = "";
		faux.setResponses([
			() => fauxAssistantMessage([fauxText("AGENT-TOOL-OK")]),
			(context) => {
				resumedContext = JSON.stringify(context.messages);
				return fauxAssistantMessage([fauxText("AGENT-RESUME-OK")]);
			},
		]);
		const model = faux.getModel();
		const runtime = fauxModelBackend(model);
		const tools = new Map<string, any>();
		const lifecycle = new Map<string, (...args: any[]) => any>();
		const sentMessages: any[] = [];
		const pi = {
			registerMessageRenderer: () => {},
			registerTool: (tool: any) => tools.set(tool.name, tool),
			registerCommand: () => {},
			on: (event: string, handler: (...args: any[]) => any) => lifecycle.set(event, handler),
			events: { emit: () => {}, on: () => () => {} },
			sendMessage: (message: any) => {
				sentMessages.push(message);
			},
			exec: async () => ({ code: 1, stdout: "", stderr: "" }),
		} as any;
		const previousCwd = process.cwd();
		process.chdir(cwd);
		try {
			installSubagents(pi);
			const tool = tools.get("Agent");
			expect(tool).toBeDefined();
			const extensionCtx = {
				cwd,
				model,
				modelRegistry: runtime.modelRegistry,
				getSystemPrompt: () => "parent",
				sessionManager: { getSessionFile: () => undefined },
				hasUI: false,
			} as any;
			const result = await tool.execute(
				"public-agent",
				{
					prompt: "answer now",
					description: "Answer test",
					subagent_type: "tool-test",
				},
				undefined,
				undefined,
				extensionCtx,
			);
			const firstText = result.content[0].text as string;
			expect(firstText).toContain("AGENT-TOOL-OK");
			const agentId = firstText.match(/Agent ID: ([^\s]+)/)?.[1];
			expect(agentId).toBeTruthy();
			expect(result.details).toMatchObject({ agentId, subagentType: "tool-test", status: "completed" });

			const incompatibleResume = await tool.execute(
				"public-agent-incompatible-resume",
				{
					prompt: "continue",
					description: "Incompatible continuation",
					subagent_type: "tool-test",
					resume: agentId,
					advisor: true,
					inherit_context: false,
					isolated: false,
					run_in_background: false,
				},
				undefined,
				undefined,
				extensionCtx,
			);
			expect(incompatibleResume.isError).toBe(true);
			expect(incompatibleResume.content[0].text).toContain("fixed when an agent session starts");

			const resumed = await tool.execute(
				"public-agent-resume",
				{
					prompt: "follow up using existing context",
					description: "Continue answer test",
					subagent_type: "tool-test",
					resume: agentId,
				},
				undefined,
				undefined,
				extensionCtx,
			);
			expect(resumed.content[0].text).toContain("AGENT-RESUME-OK");
			expect(resumed.content[0].text).toContain(`Agent ID: ${agentId}`);
			expect(resumed.details).toMatchObject({ agentId, status: "completed" });
			expect(resumedContext).toContain("answer now");
			expect(resumedContext).toContain("AGENT-TOOL-OK");
			expect(resumedContext).toContain("follow up using existing context");

			const checkResult = tools.get("get_subagent_result");
			const snapshot = await checkResult.execute(
				"public-agent-check",
				{
					agent_id: agentId,
					transcript_tail: 2,
				},
				undefined,
			);
			const snapshotText = snapshot.content[0].text as string;
			expect(snapshotText).toContain("Recent conversation (last 2 messages)");
			expect(snapshotText).toContain("follow up using existing context");
			expect(snapshotText.match(/AGENT-RESUME-OK/g)).toHaveLength(1);
			expect(snapshotText).not.toContain("answer now");
			expect(snapshotText).not.toContain("AGENT-TOOL-OK");

			const conflictingSnapshot = await checkResult.execute(
				"public-agent-conflicting-check",
				{
					agent_id: agentId,
					verbose: true,
					transcript_tail: 2,
				},
				undefined,
			);
			expect(conflictingSnapshot.isError).toBe(true);
			expect(conflictingSnapshot.content[0].text).toContain("cannot be combined");

			let releaseLiveResponse: (() => void) | undefined;
			const liveResponseGate = new Promise<void>((resolve) => {
				releaseLiveResponse = resolve;
			});
			faux.appendResponses([
				async () => {
					await liveResponseGate;
					return fauxAssistantMessage([fauxText("LIVE-AGENT-DONE")]);
				},
			]);
			const liveLaunch = await tool.execute(
				"public-agent-live",
				{
					prompt: "coordinate while running",
					description: "Live coordination test",
					subagent_type: "tool-test",
					run_in_background: true,
				},
				undefined,
				undefined,
				extensionCtx,
			);
			const liveAgentId = (liveLaunch.content[0].text as string).match(/Agent ID: ([^\s]+)/)?.[1];
			expect(liveAgentId).toBeTruthy();

			let liveSnapshotText = "";
			for (let attempt = 0; attempt < 100; attempt++) {
				const liveSnapshot = await checkResult.execute(
					"public-agent-live-check",
					{
						agent_id: liveAgentId,
						transcript_tail: 1,
					},
					undefined,
				);
				liveSnapshotText = liveSnapshot.content[0].text as string;
				if (liveSnapshotText.includes("coordinate while running")) break;
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
			expect(liveSnapshotText).toContain(`Agent ${liveAgentId} is running.`);
			expect(liveSnapshotText).toContain("coordinate while running");
			expect(liveSnapshotText).not.toContain("LIVE-AGENT-DONE");

			const stopTool = tools.get("stop_subagent");
			expect(stopTool).toBeDefined();
			const queuedLaunch = await tool.execute(
				"public-agent-queued",
				{
					prompt: "wait in the queue",
					description: "Queued stop test",
					subagent_type: "tool-test",
					run_in_background: true,
				},
				undefined,
				undefined,
				extensionCtx,
			);
			const queuedAgentId = (queuedLaunch.content[0].text as string).match(/Agent ID: ([^\s]+)/)?.[1];
			expect(queuedAgentId).toBeTruthy();
			const queuedSnapshot = await checkResult.execute(
				"public-agent-queued-check",
				{ agent_id: queuedAgentId },
				undefined,
			);
			expect(queuedSnapshot.content[0].text).toContain(`Agent ${queuedAgentId} is queued.`);
			const queuedStopped = await stopTool.execute("public-agent-stop-queued", { agent_id: queuedAgentId });
			expect(queuedStopped.isError).toBe(false);
			expect(queuedStopped.content[0].text).toBe(`Stopped subagent ${queuedAgentId}.`);
			await new Promise((resolve) => setTimeout(resolve, 150));

			releaseLiveResponse?.();
			let completedSnapshotText = "";
			for (let attempt = 0; attempt < 100; attempt++) {
				const completedSnapshot = await checkResult.execute(
					"public-agent-live-completion-check",
					{
						agent_id: liveAgentId,
						transcript_tail: 1,
					},
					undefined,
				);
				completedSnapshotText = completedSnapshot.content[0].text as string;
				if (completedSnapshotText.includes(`Agent ${liveAgentId} is completed.`)) break;
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
			expect(completedSnapshotText).toContain(`Agent ${liveAgentId} is completed.`);
			for (
				let attempt = 0;
				attempt < 100 && !sentMessages.some((message) => String(message.content).includes("LIVE-AGENT-DONE"));
				attempt++
			) {
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
			expect(sentMessages.some((message) => String(message.content).includes("LIVE-AGENT-DONE"))).toBe(true);
			expect(sentMessages.some((message) => String(message.content).includes(queuedAgentId!))).toBe(false);
			const liveResult = await checkResult.execute("public-agent-live-result", { agent_id: liveAgentId }, undefined);
			expect(liveResult.content[0].text).toContain("LIVE-AGENT-DONE");

			let releaseStoppedResponse: (() => void) | undefined;
			const stoppedResponseGate = new Promise<void>((resolve) => {
				releaseStoppedResponse = resolve;
			});
			faux.appendResponses([
				async () => {
					await stoppedResponseGate;
					return fauxAssistantMessage([fauxText("MUST-STAY-STOPPED")]);
				},
			]);
			const stoppableLaunch = await tool.execute(
				"public-agent-stoppable",
				{
					prompt: "keep working until stopped",
					description: "Model stop test",
					subagent_type: "tool-test",
					run_in_background: true,
				},
				undefined,
				undefined,
				extensionCtx,
			);
			const stoppableAgentId = (stoppableLaunch.content[0].text as string).match(/Agent ID: ([^\s]+)/)?.[1];
			expect(stoppableAgentId).toBeTruthy();

			const stopped = await stopTool.execute("public-agent-stop", { agent_id: stoppableAgentId });
			expect(stopped.isError).toBe(false);
			expect(stopped.content[0].text).toBe(`Stopped subagent ${stoppableAgentId}.`);
			releaseStoppedResponse?.();

			const stoppedSnapshot = await checkResult.execute(
				"public-agent-stopped-check",
				{
					agent_id: stoppableAgentId,
					transcript_tail: 1,
				},
				undefined,
			);
			expect(stoppedSnapshot.content[0].text).toContain(`Agent ${stoppableAgentId} is stopped.`);
			const stoppedAgain = await stopTool.execute("public-agent-stop-again", { agent_id: stoppableAgentId });
			expect(stoppedAgain.isError).toBe(true);
		} finally {
			await lifecycle.get("session_shutdown")?.();
			process.chdir(previousCwd);
		}
	}, 30_000);

	it("keeps managed orchestrator sessions fresh and unreachable through public controls", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "apple-pi-managed-agent-"));
		temporaryDirectories.push(cwd);
		const faux = registerFauxProvider({ provider: "faux", models: [{ id: "faux-managed", contextWindow: 200_000 }] });
		fauxProviders.push(faux);
		faux.setResponses([() => fauxAssistantMessage([fauxText("MANAGED-OK")])]);
		const model = faux.getModel();
		const runtime = fauxModelBackend(model);
		const tools = new Map<string, any>();
		const lifecycle = new Map<string, (...args: any[]) => any>();
		const pi = {
			registerMessageRenderer: () => {},
			registerTool: (tool: any) => tools.set(tool.name, tool),
			registerCommand: () => {},
			on: (event: string, handler: (...args: any[]) => any) => lifecycle.set(event, handler),
			events: { emit: () => {}, on: () => () => {} },
			sendMessage: () => {},
			exec: async () => ({ code: 1, stdout: "", stderr: "" }),
		} as any;
		const previousCwd = process.cwd();
		process.chdir(cwd);
		try {
			installSubagents(pi);
			const service = getManagedSubagentService();
			expect(service).toBeDefined();
			const record = await service!.runFresh(
				{
					cwd,
					model,
					modelRegistry: runtime.modelRegistry,
					getSystemPrompt: () => "parent",
					sessionManager: { getSessionFile: () => undefined },
				} as any,
				{
					type: "managed-test",
					description: "Managed test",
					prompt: "answer",
					agentConfig: {
						name: "managed-test",
						description: "managed",
						builtinToolNames: ["read"],
						extensions: false,
						skills: false,
						persistSession: false,
						systemPrompt: "Answer.",
						promptMode: "replace",
					},
				},
			);
			expect(record.result).toBe("MANAGED-OK");
			expect(record.internalOwner).toBe("managed:managed-test");
			expect(record.session).toBeUndefined();
			const resume = await tools.get("Agent").execute(
				"resume-managed",
				{
					resume: record.id,
					prompt: "continue",
					description: "resume",
					subagent_type: "general-purpose",
				},
				undefined,
				undefined,
				{ cwd, model, modelRegistry: runtime.modelRegistry } as any,
			);
			expect(resume.isError).toBe(true);
			expect(resume.content[0].text).toContain("not found");
			const result = await tools
				.get("get_subagent_result")
				.execute("result-managed", { agent_id: record.id }, undefined);
			expect(result.isError).toBe(true);
			const steer = await tools
				.get("steer_subagent")
				.execute("steer-managed", { agent_id: record.id, message: "change" });
			expect(steer.isError).toBe(true);
			const stop = await tools.get("stop_subagent").execute("stop-managed", { agent_id: record.id });
			expect(stop.isError).toBe(true);
		} finally {
			await lifecycle.get("session_shutdown")?.();
			process.chdir(previousCwd);
		}
	}, 30_000);

	it("uses full parent context only when the invocation requests it", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "apple-pi-agent-context-trust-"));
		temporaryDirectories.push(cwd);
		const faux = registerFauxProvider({
			provider: "faux",
			models: [{ id: "faux-context-trust", contextWindow: 200_000 }],
		});
		fauxProviders.push(faux);
		const requests: string[] = [];
		faux.setResponses([
			(context) => {
				requests.push(JSON.stringify(context));
				return fauxAssistantMessage([fauxText("UNTRUSTED")]);
			},
			(context) => {
				requests.push(JSON.stringify(context));
				return fauxAssistantMessage([fauxText("TRUSTED")]);
			},
		]);
		const model = faux.getModel();
		const runtime = fauxModelBackend(model);
		const run = async (inheritContext: boolean, projectTrusted: boolean) => {
			registerAgents(
				new Map<string, AgentConfig>([
					[
						"context-trust",
						{
							name: "context-trust",
							description: "context trust test",
							builtinToolNames: ["read"],
							extensions: false,
							skills: false,
							persistSession: false,
							source: "project",
							systemPrompt: "Answer the task.",
							promptMode: "replace",
						},
					],
				]),
			);
			const result = await runAgent(
				{
					cwd,
					model,
					modelRegistry: runtime.modelRegistry,
					getSystemPrompt: () => "parent",
					isProjectTrusted: () => projectTrusted,
					sessionManager: {
						getSessionFile: () => undefined,
						getBranch: () => [
							{ type: "message", message: { role: "user", content: [{ type: "text", text: "earlier-secret" }] } },
							{ type: "message", message: { role: "user", content: [{ type: "text", text: "latest-handoff" }] } },
						],
					},
				} as any,
				"context-trust",
				"answer",
				{
					pi: { exec: async () => ({ code: 1, stdout: "", stderr: "" }) } as any,
					model,
					inheritContext,
				},
			);
			result.session.dispose();
		};

		await run(false, true);
		await run(true, false);
		expect(requests[0]).not.toContain("earlier-secret");
		expect(requests[0]).not.toContain("latest-handoff");
		expect(requests[1]).toContain("earlier-secret");
		expect(requests[1]).toContain("latest-handoff");
	}, 30_000);

	it("loads the advisor sidecar only when requested", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "apple-pi-agent-advisor-scope-"));
		temporaryDirectories.push(cwd);
		const extensionPath = join(cwd, "pi-advisor.ts");
		writeFileSync(
			extensionPath,
			`
export default function advisorMarker(pi) {
	pi.registerTool({
		name: "child_advisor_marker",
		label: "child_advisor_marker",
		description: "marker",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		execute: async () => ({ content: [{ type: "text", text: "marker" }] }),
	});
}
`,
		);
		const faux = registerFauxProvider({
			provider: "faux",
			models: [{ id: "faux-advisor-scope", contextWindow: 200_000 }],
		});
		fauxProviders.push(faux);
		faux.setResponses([
			() => fauxAssistantMessage([fauxText("ADVISOR-OFF")]),
			() => fauxAssistantMessage([fauxText("ADVISOR-ON")]),
			() => fauxAssistantMessage([fauxText("ADVISOR-UNTRUSTED")]),
		]);
		const model = faux.getModel();
		const runtime = fauxModelBackend(model);

		const run = async (advisor: boolean, projectTrusted = true) => {
			registerAgents(
				new Map<string, AgentConfig>([
					[
						"advisor-scope",
						{
							name: "advisor-scope",
							description: "advisor scope test",
							builtinToolNames: ["read"],
							extensions: [extensionPath],
							skills: false,
							persistSession: false,
							source: "project",
							systemPrompt: "Answer the task.",
							promptMode: "replace",
						},
					],
				]),
			);
			let tools: string[] = [];
			const result = await runAgent(
				{
					cwd,
					model,
					modelRegistry: runtime.modelRegistry,
					getSystemPrompt: () => "parent",
					sessionManager: { getSessionFile: () => undefined },
					isProjectTrusted: () => projectTrusted,
				} as any,
				"advisor-scope",
				"answer",
				{
					pi: { exec: async () => ({ code: 1, stdout: "", stderr: "" }) } as any,
					model,
					advisor,
					onSessionCreated: (session) => {
						tools = session.getAllTools().map((tool) => tool.name);
					},
				},
			);
			const systemPrompt = result.session.systemPrompt;
			result.session.dispose();
			return { tools, systemPrompt };
		};

		const off = await run(false);
		expect(off.tools).not.toContain("child_advisor_marker");
		expect(off.systemPrompt).not.toContain("<advisor-protocol>");
		const on = await run(true);
		expect(on.tools).not.toContain("child_advisor_marker");
		expect(on.systemPrompt).toContain("<advisor-protocol>");
		const untrusted = await run(true, false);
		expect(untrusted.tools).not.toContain("child_advisor_marker");
		expect(untrusted.systemPrompt).toContain("<advisor-protocol>");
	}, 30_000);

	it("does not load a custom extensions path and keeps pi_exec out of child sessions", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "apple-pi-agent-root-only-tool-"));
		temporaryDirectories.push(cwd);
		const extensionPath = join(cwd, "child-tools.ts");
		writeFileSync(
			extensionPath,
			`
export default function childTools(pi) {
	const parameters = { type: "object", properties: {}, additionalProperties: false };
	for (const name of ["pi_exec", "safe_extension_tool"]) {
		pi.registerTool({
			name,
			label: name,
			description: name,
			parameters,
			execute: async () => ({ content: [{ type: "text", text: name }] }),
		});
	}
}
`,
		);
		const faux = registerFauxProvider({
			provider: "faux",
			models: [{ id: "faux-root-only-tool", contextWindow: 200_000 }],
		});
		fauxProviders.push(faux);
		faux.setResponses([() => fauxAssistantMessage([fauxText("ROOT-ONLY-TOOL-OK")])]);
		const model = faux.getModel();
		const runtime = fauxModelBackend(model);

		registerAgents(
			new Map<string, AgentConfig>([
				[
					"extension-agent",
					{
						name: "extension-agent",
						description: "extension scope test",
						builtinToolNames: ["read"],
						extSelectors: ["ext:child-tools/pi_exec", "ext:child-tools/safe_extension_tool"],
						extensions: [extensionPath],
						skills: false,
						persistSession: false,
						allowedSubagents: "all",
						systemPrompt: "Answer the task.",
						promptMode: "replace",
					},
				],
			]),
		);

		let registeredTools: string[] = [];
		let activeTools: string[] = [];
		const result = await runAgent(
			{
				cwd,
				model,
				modelRegistry: runtime.modelRegistry,
				getSystemPrompt: () => "parent",
				sessionManager: { getSessionFile: () => undefined },
			} as any,
			"extension-agent",
			"confirm tool scope",
			{
				pi: { exec: async () => ({ code: 1, stdout: "", stderr: "" }) } as any,
				model,
				nestedRuntime: {
					manager: {} as any,
					parentAgentId: "parent-agent",
					depth: 0,
					maxSubagentDepth: 2,
				},
				onSessionCreated: (session) => {
					registeredTools = session.getAllTools().map((tool) => tool.name);
					activeTools = session.getActiveToolNames();
				},
			},
		);

		expect(result.responseText).toBe("ROOT-ONLY-TOOL-OK");
		expect(registeredTools).not.toContain("safe_extension_tool");
		expect(activeTools).not.toContain("safe_extension_tool");
		expectActiveTools(
			activeTools.filter((name) => !Object.values(SUBAGENT_TOOL_NAMES).includes(name)),
			["read"],
		);
		for (const name of Object.values(SUBAGENT_TOOL_NAMES)) {
			expect(registeredTools).toContain(name);
			expect(activeTools).toContain(name);
		}
		expect(registeredTools).not.toContain("pi_exec");
		expect(activeTools).not.toContain("pi_exec");
		result.session.dispose();
	}, 30_000);

	it("persists a child session with VCC and without observational memory", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "apple-pi-agent-context-"));
		temporaryDirectories.push(cwd);
		process.env.PI_VCC_CONFIG_PATH = join(cwd, "vcc.json");
		const faux = registerFauxProvider({ provider: "faux", models: [{ id: "faux-context", contextWindow: 200_000 }] });
		fauxProviders.push(faux);
		faux.setResponses([() => fauxAssistantMessage([fauxText("MEMORY-READY")])]);
		const model = faux.getModel();
		const runtime = fauxModelBackend(model);

		registerAgents(
			new Map<string, AgentConfig>([
				[
					"memory-agent",
					{
						name: "memory-agent",
						description: "memory test",
						builtinToolNames: ["read"],
						extensions: [join(process.cwd(), "extensions", "context.ts")],
						skills: false,
						persistSession: true,
						sessionDir: join(cwd, "sessions"),
						systemPrompt: "Answer the task.",
						promptMode: "replace",
					},
				],
			]),
		);

		let activeTools: string[] = [];
		const result = await runAgent(
			{
				cwd,
				model,
				modelRegistry: runtime.modelRegistry,
				getSystemPrompt: () => "parent",
				sessionManager: { getSessionFile: () => undefined },
			} as any,
			"memory-agent",
			"confirm memory",
			{
				pi: { exec: async () => ({ code: 1, stdout: "", stderr: "" }) } as any,
				model,
				onSessionCreated: (session) => {
					activeTools = session.getActiveToolNames();
				},
			},
		);

		expect(result.responseText).toBe("MEMORY-READY");
		expectActiveTools(activeTools, ["read"]);
		expect(activeTools).toContain("vcc_recall");
		expect(activeTools).not.toContain("recall");
		expect(result.session.sessionManager.getSessionFile()).toBeTruthy();
		expect(existsSync(result.session.sessionManager.getSessionFile()!)).toBe(true);
		result.session.dispose();
	}, 30_000);
});

import type { Model } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	defineTool,
	type ExtensionAPI,
	type ExtensionContext,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type ResultWaitMode, resolveResultWaitMode, waitForAgentSettlement } from "./abortable.js";
import {
	buildAgentRegistry,
	getAgentConfigIn,
	getAvailableTypesIn,
	resolveEnabledTypeIn,
	resolveTypeIn,
} from "./agent-types.js";
import { getAgentConversation } from "./conversation.js";
import { loadCustomAgents } from "./custom-agents.js";
import { resolveAgentInvocationConfig } from "./invocation-config.js";
import { INFERENCE_PROFILE_PARAMETER_SCHEMA, resolveAgentProfile } from "./model-routing.js";
import { continuationSuffix, getForegroundOutcomeNote, getStatusNote, partialOutputSuffix } from "./status-note.js";
import type { AgentConfig, AgentInvocation, AgentRecord, ThinkingLevel } from "./types.js";
import { addUsage } from "./usage.js";

let maxSubagentDepth = 2;

export function getMaxSubagentDepth(): number {
	return maxSubagentDepth;
}
export function setMaxSubagentDepth(n: number): void {
	maxSubagentDepth = Math.max(0, Math.floor(n));
}

export const SUBAGENT_TOOL_NAMES = {
	AGENT: "Agent",
	GET_RESULT: "get_subagent_result",
	STEER: "steer_subagent",
	STOP: "stop_subagent",
} as const;

interface NestedSpawnOptions {
	description: string;
	/** Exact enabled config authorized by this nested dispatch. */
	agentConfig: AgentConfig;
	/** Invocation-level guidance appended after the selected definition and skills. */
	systemPrompt?: string;
	model?: Model<any>;
	modelResolved?: boolean;
	/** Trusted agent-definition turn ceiling; never supplied by the parent model. */
	maxTurns?: number;
	isolated?: boolean;
	inheritContext?: boolean;
	advisor?: boolean;
	thinkingLevel?: ThinkingLevel;
	isBackground?: boolean;
	invocation?: AgentInvocation;
	signal?: AbortSignal;
	onAssistantUsage?: (usage: { input: number; output: number; cacheWrite: number }) => void;
	onSessionCreated?: (session: AgentSession) => void;
	depth: number;
	parentAgentId: string;
	maxSubagentDepth: number;
	configCwd?: string;
}

export interface NestedAgentManager {
	spawn(pi: ExtensionAPI, ctx: ExtensionContext, type: string, prompt: string, options: NestedSpawnOptions): string;
	spawnAndWait(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		type: string,
		prompt: string,
		options: Omit<NestedSpawnOptions, "isBackground">,
		onSpawned?: (id: string) => void,
	): Promise<{ id: string; record: AgentRecord }>;
	getRecord(id: string): AgentRecord | undefined;
	resume(id: string, prompt: string, signal?: AbortSignal): Promise<AgentRecord | undefined>;
	steer(id: string, message: string): boolean;
	abort(id: string): boolean;
}

export interface NestedToolContext {
	manager: NestedAgentManager;
	pi: ExtensionAPI;
	parentAgentId: string;
	depth: number;
	maxSubagentDepth: number;
	allowedSubagents: "all" | string[];
	configCwd: string;
	projectTrusted: boolean;
}

function textResult(text: string, isError = false) {
	return { content: [{ type: "text" as const, text }], isError, details: {} };
}

function ownsRecord(record: AgentRecord | undefined, parentAgentId: string): record is AgentRecord {
	return record?.parentAgentId === parentAgentId;
}

function formatRecord(record: AgentRecord, inline: boolean): string {
	if (record.status === "error")
		return `Agent failed: ${record.error ?? "unknown error"}${partialOutputSuffix(record)}${continuationSuffix(record)}`;
	if (record.status === "queued" || record.status === "running") return `Agent ${record.id} is ${record.status}.`;
	const text = record.result?.trim() || record.error?.trim() || "No output.";
	const note = inline ? getForegroundOutcomeNote(record.status) : getStatusNote(record.status);
	return `${note ? `Nested agent${note}.\n\n${text}` : text}${continuationSuffix(record)}`;
}

/** Child-safe orchestration tools scoped to the parent that owns them. */
export function createNestedSubagentTools(context: NestedToolContext): ToolDefinition[] {
	const loadRegistry = () =>
		buildAgentRegistry(loadCustomAgents({ cwd: context.configCwd, projectTrusted: context.projectTrusted }));
	const allowedTypesIn = (registry: Map<string, AgentConfig>): Set<string> | undefined =>
		context.allowedSubagents === "all"
			? undefined
			: new Set(context.allowedSubagents.map((name) => resolveTypeIn(registry, name) ?? name));
	const availableIn = (registry: Map<string, AgentConfig>): string[] => {
		const allowed = allowedTypesIn(registry);
		return getAvailableTypesIn(registry).filter((name) => allowed === undefined || allowed.has(name));
	};

	const agentTool = defineTool({
		name: SUBAGENT_TOOL_NAMES.AGENT,
		label: "Agent",
		description:
			"Launch an ownership-scoped nested subagent. Agent definitions must opt in with allowed_subagents. system_prompt appends invocation-specific guidance to the selected definition without changing capabilities.",
		parameters: Type.Object({
			prompt: Type.String({ description: "Self-contained task for the nested agent." }),
			description: Type.String({ description: "Short task description." }),
			subagent_type: Type.String({
				description: `Allowed type. Available: ${availableIn(loadRegistry()).join(", ") || "none"}.`,
			}),
			profile: Type.Optional(INFERENCE_PROFILE_PARAMETER_SCHEMA),
			system_prompt: Type.Optional(
				Type.String({
					minLength: 1,
					description:
						"Invocation-specific system guidance appended after the selected definition and preloaded skills. It cannot change capabilities and is fixed for the session.",
				}),
			),
			resume: Type.Optional(Type.String({ description: "Owned child agent ID to resume." })),
			run_in_background: Type.Boolean({ default: false, description: "Run without waiting for completion." }),
			isolated: Type.Boolean({
				default: false,
				description: "Disable skill inheritance for a new agent session.",
			}),
			inherit_context: Type.Boolean({
				default: false,
				description: "Include the full parent conversation before the initial task prompt.",
			}),
			advisor: Type.Optional(
				Type.Boolean({
					description:
						"Override the agent definition's Advisor default. Omit to use the definition; false disables it when the definition enables it.",
				}),
			),
		}),
		execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
			if (params.resume) {
				const existing = context.manager.getRecord(params.resume);
				if (!ownsRecord(existing, context.parentAgentId)) {
					return textResult(`Nested agent not found or not owned by this parent: "${params.resume}".`, true);
				}
				const requestedInheritance = params.inherit_context === true;
				const requestedAdvisor = params.advisor ?? existing.invocation?.advisor === true;
				const requestedIsolation = params.isolated === true;
				const requestedProfile = params.profile ?? existing.invocation?.profile;
				const requestedSystemPrompt = params.system_prompt?.trim() || existing.invocation?.systemPrompt;
				if (
					requestedInheritance !== (existing.invocation?.inheritContext === true) ||
					requestedAdvisor !== (existing.invocation?.advisor === true) ||
					requestedIsolation !== (existing.invocation?.isolated === true) ||
					requestedProfile !== existing.invocation?.profile ||
					requestedSystemPrompt !== existing.invocation?.systemPrompt
				) {
					return textResult(
						"profile, system_prompt, inherit_context, advisor, and isolated are fixed when an agent session starts; resume it with the original values or launch a new agent.",
						true,
					);
				}
				const resumed = await context.manager.resume(params.resume, params.prompt, signal);
				return resumed
					? textResult(formatRecord(resumed, true), resumed.status === "error")
					: textResult(`Failed to resume nested agent "${params.resume}".`, true);
			}

			if (context.depth >= context.maxSubagentDepth) {
				return textResult(
					`Nested subagent call blocked at depth ${context.depth} (max ${context.maxSubagentDepth}).`,
					true,
				);
			}

			const registry = loadRegistry();
			const resolvedType = resolveEnabledTypeIn(registry, params.subagent_type);
			const allowed = allowedTypesIn(registry);
			if (!resolvedType || (allowed && !allowed.has(resolvedType))) {
				return textResult(
					`Unknown or disallowed nested agent type: "${params.subagent_type}". Allowed: ${availableIn(registry).join(", ") || "none"}.`,
					true,
				);
			}

			const config = getAgentConfigIn(registry, resolvedType);
			if (!config) return textResult(`Unknown or disabled nested agent type: "${resolvedType}".`, true);
			const resolvedAgentProfile = resolveAgentProfile({
				registry: ctx.modelRegistry,
				parentModel: ctx.model,
				parentThinking: ctx.thinkingLevel,
				config,
				explicitProfile: params.profile,
			});
			if (resolvedAgentProfile.error) return textResult(resolvedAgentProfile.error, true);
			const invocation = resolveAgentInvocationConfig(config, params);
			const model = resolvedAgentProfile.model;

			const options: NestedSpawnOptions = {
				description: params.description,
				agentConfig: config,
				systemPrompt: invocation.systemPrompt,
				model,
				modelResolved: true,
				maxTurns: invocation.maxTurns,
				isolated: invocation.isolated,
				inheritContext: invocation.inheritContext,
				advisor: invocation.advisor,
				thinkingLevel: resolvedAgentProfile.thinkingLevel,
				invocation: {
					profile: resolvedAgentProfile.profile,
					systemPrompt: invocation.systemPrompt,
					thinking: resolvedAgentProfile.thinkingLevel,
					maxTurns: invocation.maxTurns,
					isolated: invocation.isolated,
					inheritContext: invocation.inheritContext,
					advisor: invocation.advisor,
					runInBackground: invocation.runInBackground,
				},
				onAssistantUsage: (usage) => {
					for (let id: string | undefined = context.parentAgentId; id !== undefined; ) {
						const ancestor = context.manager.getRecord(id);
						if (!ancestor) break;
						addUsage(ancestor.lifetimeUsage, usage);
						id = ancestor.parentAgentId;
					}
				},
				depth: context.depth + 1,
				parentAgentId: context.parentAgentId,
				maxSubagentDepth: context.maxSubagentDepth,
				configCwd: context.configCwd,
			};

			try {
				if (invocation.runInBackground) {
					const id = context.manager.spawn(context.pi, ctx, resolvedType, params.prompt, {
						...options,
						isBackground: true,
					});
					return textResult(
						`Nested agent started in background. Agent ID: ${id}\n\nCall get_subagent_result with this agent_id to wait for its final result.`,
					);
				}
				const { record } = await context.manager.spawnAndWait(context.pi, ctx, resolvedType, params.prompt, {
					...options,
					signal,
				});
				return textResult(formatRecord(record, true), record.status === "error");
			} catch (error) {
				return textResult(error instanceof Error ? error.message : String(error), true);
			}
		},
	});

	const resultTool = defineTool({
		name: SUBAGENT_TOOL_NAMES.GET_RESULT,
		label: "Get Nested Agent Result",
		description:
			"Check an owned child, waiting until it settles by default. wait_seconds may choose an uncapped positive finite timeout; 0 checks immediately, and an expired wait returns control while the child continues. Use transcript_tail for a bounded recent conversation slice; it cannot be combined with a positive wait.",
		parameters: Type.Object({
			agent_id: Type.String(),
			wait_seconds: Type.Optional(
				Type.Number({
					minimum: 0,
					description:
						"Seconds to wait before yielding control. Omit to wait until settlement (or to take an immediate transcript_tail snapshot); 0 always checks immediately, and positive finite values have no application maximum.",
				}),
			),
			transcript_tail: Type.Optional(
				Type.Number({
					minimum: 1,
					maximum: 20,
					description:
						"Append up to 12,000 characters from the most recent N conversation messages, including current streaming output.",
				}),
			),
		}),
		execute: async (_toolCallId, params, signal) => {
			let waitMode: ResultWaitMode;
			try {
				waitMode = resolveResultWaitMode(params.wait_seconds, params.transcript_tail !== undefined);
			} catch (error) {
				return textResult(error instanceof Error ? error.message : String(error), true);
			}
			if (params.transcript_tail !== undefined && waitMode.kind === "timed") {
				return textResult("transcript_tail cannot be combined with a positive wait_seconds value.", true);
			}
			const record = context.manager.getRecord(params.agent_id);
			if (!ownsRecord(record, context.parentAgentId))
				return textResult("Nested agent not found or not owned by this parent.", true);
			let waitExpiredSeconds: number | undefined;
			if (waitMode.kind !== "immediate" && (record.status === "queued" || record.status === "running")) {
				const outcome = await waitForAgentSettlement(record, waitMode, signal);
				if (outcome === "timed-out" && waitMode.kind === "timed") waitExpiredSeconds = waitMode.seconds;
			}
			let output =
				params.transcript_tail === undefined ? formatRecord(record, false) : `Agent ${record.id} is ${record.status}.`;
			if (waitExpiredSeconds !== undefined && (record.status === "queued" || record.status === "running")) {
				output += `\n\nWait limit (${waitExpiredSeconds}s) reached; it continues in the background. Please call get_subagent_result again to continue waiting.`;
			}
			if (params.transcript_tail !== undefined && record.session) {
				const tail = Math.min(20, Math.max(1, Math.floor(params.transcript_tail)));
				const transcript = getAgentConversation(record.session, tail) || "(no conversation messages yet)";
				output += `\n\n--- Recent conversation (last ${tail} messages) ---\n${transcript}`;
			}
			return textResult(output, record.status === "error");
		},
	});

	const steerTool = defineTool({
		name: SUBAGENT_TOOL_NAMES.STEER,
		label: "Steer Nested Agent",
		description: "Send guidance to a running child owned by this agent.",
		parameters: Type.Object({ agent_id: Type.String(), message: Type.String() }),
		execute: async (_toolCallId, params) => {
			const record = context.manager.getRecord(params.agent_id);
			if (!ownsRecord(record, context.parentAgentId) || !context.manager.steer(params.agent_id, params.message)) {
				return textResult("Running nested agent not found or not owned by this parent.", true);
			}
			return textResult(`Steering message sent to nested agent ${params.agent_id}.`);
		},
	});

	const stopTool = defineTool({
		name: SUBAGENT_TOOL_NAMES.STOP,
		label: "Stop Nested Agent",
		description: "Stop a running or queued child owned by this agent.",
		parameters: Type.Object({ agent_id: Type.String() }),
		execute: async (_toolCallId, params) => {
			const record = context.manager.getRecord(params.agent_id);
			if (!ownsRecord(record, context.parentAgentId) || !context.manager.abort(params.agent_id)) {
				return textResult("Running or queued nested agent not found or not owned by this parent.", true);
			}
			return textResult(`Stopped nested agent ${params.agent_id}.`);
		},
	});

	return [agentTool, resultTool, steerTool, stopTool];
}

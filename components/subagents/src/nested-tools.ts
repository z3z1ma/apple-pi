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
	pair?: boolean;
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
	resume(
		id: string,
		prompt: string,
		signal?: AbortSignal,
		options?: { isBackground?: boolean },
	): Promise<AgentRecord | undefined>;
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
			"Bring in one ownership-scoped teammate when their focused contribution will help your assigned work. Their definition must explicitly allow nested collaboration. system_prompt adds invocation-specific guidance without changing capabilities.",
		parameters: Type.Object({
			prompt: Type.String({ description: "A self-contained task for your teammate." }),
			description: Type.String({ description: "A short description of their task." }),
			subagent_type: Type.String({
				description: `An allowed teammate. Available: ${availableIn(loadRegistry()).join(", ") || "none"}.`,
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
			pair: Type.Optional(
				Type.Boolean({
					description:
						"Override the agent definition's Pair default. Omit to use the definition; false disables it when the definition enables it.",
				}),
			),
		}),
		execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
			if (params.resume) {
				const existing = context.manager.getRecord(params.resume);
				if (!ownsRecord(existing, context.parentAgentId)) {
					return textResult(`Teammate not found or not owned by this session: "${params.resume}".`, true);
				}
				const requestedInheritance = params.inherit_context === true;
				const requestedPair = params.pair ?? existing.invocation?.pair === true;
				const requestedIsolation = params.isolated === true;
				const requestedProfile = params.profile ?? existing.invocation?.profile;
				const requestedSystemPrompt = params.system_prompt?.trim() || existing.invocation?.systemPrompt;
				if (
					requestedInheritance !== (existing.invocation?.inheritContext === true) ||
					requestedPair !== (existing.invocation?.pair === true) ||
					requestedIsolation !== (existing.invocation?.isolated === true) ||
					requestedProfile !== existing.invocation?.profile ||
					requestedSystemPrompt !== existing.invocation?.systemPrompt
				) {
					return textResult(
						"profile, system_prompt, inherit_context, pair, and isolated are fixed when an agent session starts; resume it with the original values or launch a new agent.",
						true,
					);
				}
				const background = params.run_in_background === true;
				const resumed = await context.manager.resume(params.resume, params.prompt, background ? undefined : signal, {
					isBackground: background,
				});
				if (!resumed) return textResult(`Could not resume teammate "${params.resume}".`, true);
				return background
					? textResult(
							`Your teammate resumed in the background. Agent ID: ${resumed.id}\n\nCall get_subagent_result with this agent_id when you are ready for their final report.`,
						)
					: textResult(formatRecord(resumed, true), resumed.status === "error");
			}

			if (context.depth >= context.maxSubagentDepth) {
				return textResult(
					`This teammate cannot bring in another teammate at depth ${context.depth} (max ${context.maxSubagentDepth}).`,
					true,
				);
			}

			const registry = loadRegistry();
			const resolvedType = resolveEnabledTypeIn(registry, params.subagent_type);
			const allowed = allowedTypesIn(registry);
			if (!resolvedType || (allowed && !allowed.has(resolvedType))) {
				return textResult(
					`Unknown or unavailable teammate: "${params.subagent_type}". Available: ${availableIn(registry).join(", ") || "none"}.`,
					true,
				);
			}

			const config = getAgentConfigIn(registry, resolvedType);
			if (!config) return textResult(`Unknown or unavailable teammate: "${resolvedType}".`, true);
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
				pair: invocation.pair,
				thinkingLevel: resolvedAgentProfile.thinkingLevel,
				invocation: {
					profile: resolvedAgentProfile.profile,
					systemPrompt: invocation.systemPrompt,
					thinking: resolvedAgentProfile.thinkingLevel,
					maxTurns: invocation.maxTurns,
					isolated: invocation.isolated,
					inheritContext: invocation.inheritContext,
					pair: invocation.pair,
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
						`Your teammate is working in the background. Agent ID: ${id}\n\nCall get_subagent_result with this agent_id when you are ready for their final report.`,
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
			"Wait for an owned teammate to finish and receive their report. Omit yield_seconds to wait until they settle. If you need a bounded wait, use a very large value (normally 3,600 seconds or more); reaching it leaves them working in the background. Use 0 only for an immediate check. transcript_tail shows a bounded recent conversation slice and cannot be combined with a positive yield.",
		parameters: Type.Object({
			agent_id: Type.String(),
			yield_seconds: Type.Optional(
				Type.Number({
					minimum: 0,
					description:
						"Seconds to wait before yielding control, not a child timeout. Omit to wait until settlement (or to take an immediate transcript_tail snapshot). If you set it, use a very large positive value (normally 3,600 seconds or more) because this call returns as soon as the child settles; 0 only checks immediately. A yielded call leaves the queued or running child working.",
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
				waitMode = resolveResultWaitMode(params.yield_seconds, params.transcript_tail !== undefined);
			} catch (error) {
				return textResult(error instanceof Error ? error.message : String(error), true);
			}
			if (params.transcript_tail !== undefined && waitMode.kind === "yield") {
				return textResult("transcript_tail cannot be combined with a positive yield_seconds value.", true);
			}
			const record = context.manager.getRecord(params.agent_id);
			if (!ownsRecord(record, context.parentAgentId))
				return textResult("Teammate not found or not owned by this session.", true);
			let yieldedSeconds: number | undefined;
			if (waitMode.kind !== "immediate" && (record.status === "queued" || record.status === "running")) {
				const outcome = await waitForAgentSettlement(record, waitMode, signal);
				if (outcome === "yielded" && waitMode.kind === "yield") yieldedSeconds = waitMode.seconds;
			}
			let output =
				params.transcript_tail === undefined ? formatRecord(record, false) : `Agent ${record.id} is ${record.status}.`;
			if (yieldedSeconds !== undefined && (record.status === "queued" || record.status === "running")) {
				output += `\n\nYield interval (${yieldedSeconds}s) reached; the child is still working in the background and was not stopped. Call get_subagent_result again only when you need another check-in.`;
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
		description: "Send additional guidance to a running teammate you brought in.",
		parameters: Type.Object({ agent_id: Type.String(), message: Type.String() }),
		execute: async (_toolCallId, params) => {
			const record = context.manager.getRecord(params.agent_id);
			if (!ownsRecord(record, context.parentAgentId) || !context.manager.steer(params.agent_id, params.message)) {
				return textResult("Running teammate not found or not owned by this session.", true);
			}
			return textResult(`Your guidance was sent to teammate ${params.agent_id}.`);
		},
	});

	const stopTool = defineTool({
		name: SUBAGENT_TOOL_NAMES.STOP,
		label: "Stop Nested Agent",
		description: "Stop a running or queued teammate you brought in.",
		parameters: Type.Object({ agent_id: Type.String() }),
		execute: async (_toolCallId, params) => {
			const record = context.manager.getRecord(params.agent_id);
			if (!ownsRecord(record, context.parentAgentId) || !context.manager.abort(params.agent_id)) {
				return textResult("Running or queued teammate not found or not owned by this session.", true);
			}
			return textResult(`Stopped teammate ${params.agent_id}.`);
		},
	});

	return [agentTool, resultTool, steerTool, stopTool];
}

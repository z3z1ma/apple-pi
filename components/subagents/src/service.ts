import type { Model } from "@earendil-works/pi-ai";
import type { EventBus, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ConsultationContext, AdvisorConsultationResult } from "./consultation.js";
import type { AgentConfig, AgentRecord, ThinkingLevel } from "./types.js";

export type HarnessActivityPhase = "thinking" | "tool";

export interface AssistantUsageDelta {
	input: number;
	cacheRead: number;
	cacheWrite: number;
	output: number;
	cost: number;
}

/** Bounded, sanitized role activity. Never includes IDs, paths, prompts, args, or model text. */
export interface HarnessBoundedActivity {
	phase: HarnessActivityPhase;
	toolName?: string;
	turnCount: number;
	toolCount: number;
	label: string;
}

export interface ManagedAgentToolPolicyCall {
	toolName: string;
	args: unknown;
}

export interface ManagedAgentToolPolicyResult {
	block: true;
	reason: string;
	terminate?: boolean;
}

export type ManagedAgentToolPolicy = (
	call: ManagedAgentToolPolicyCall,
	signal?: AbortSignal,
) => ManagedAgentToolPolicyResult | undefined | Promise<ManagedAgentToolPolicyResult | undefined>;

export interface ManagedAgentRequest {
	type: string;
	description: string;
	prompt: string;
	agentConfig: AgentConfig;
	model?: Model<any>;
	/** Invocation-specific system overlay appended after the agent definition. */
	systemPrompt?: string;
	maxTurns?: number;
	/** Per-invocation live usage ceiling; the service aborts before another tool/turn after it is reached. */
	maxTokens?: number;
	/** Abort immediately at maxTurns instead of using the public soft-limit grace window. */
	hardTurnLimit?: boolean;
	toolExecution?: "sequential" | "parallel";
	thinkingLevel?: ThinkingLevel;
	cwd?: string;
	signal?: AbortSignal;
	toolPolicy?: ManagedAgentToolPolicy;
	/** Controller-supplied typed result tools, available even when extensions are disabled. */
	customTools?: ToolDefinition[];
	/** Keep only mandatory child safety extensions when false. */
	loadStandardChildExtensions?: boolean;
	internalOwner?: string;
	onStarted?: (agentId: string) => void;
	onAssistantUsage?: (usage: AssistantUsageDelta) => void;
	onCompaction?: (info: { reason: "manual" | "threshold" | "overflow"; tokensBefore: number }) => void;
	/** Sanitized activity for owning harness controllers. Does not change public visibility. */
	onActivity?: (activity: HarnessBoundedActivity) => void;
}

export interface ManagedBackgroundRequest {
	type: string;
	description: string;
	prompt: string;
	/** Optional catalog profile; type, model, and policy are resolved by the subagent owner. */
	profile?: string;
	cwd?: string;
	onActivity?: (activity: HarnessBoundedActivity) => void;
	onAssistantUsage?: (usage: AssistantUsageDelta) => void;
}

export interface ManagedConsultationRequest {
	context: ConsultationContext;
	/** Optional explicit inference override. Pair consultations use Advisor's configured deep profile. */
	profile?: string;
	signal?: AbortSignal;
	onActivity?: (activity: HarnessBoundedActivity) => void;
}

export interface ManagedBackgroundRun {
	id: string;
	completion: Promise<AgentRecord>;
	abort(): boolean;
}

export interface ManagedSubagentService {
	runFresh(ctx: ExtensionContext, request: ManagedAgentRequest): Promise<AgentRecord>;
	/** Start one ordinary public background AgentRecord through the owned manager. */
	startBackground(ctx: ExtensionContext, request: ManagedBackgroundRequest): ManagedBackgroundRun;
	/** Run one hidden, read-only Advisor adjudication with Pair and nesting disabled. */
	runConsultation(ctx: ExtensionContext, request: ManagedConsultationRequest): Promise<AdvisorConsultationResult>;
	abort(agentId: string): boolean;
}

const SERVICE_REQUEST_CHANNEL = "apple-pi:managed-subagent-service:request";
let installedService: ManagedSubagentService | undefined;

/**
 * Install the process-local service and expose it across Pi's isolated extension
 * module graphs through the shared runtime event bus.
 */
export function installManagedSubagentService(service: ManagedSubagentService, events?: EventBus): () => void {
	installedService = service;
	const unsubscribe = events?.on(SERVICE_REQUEST_CHANNEL, (reply) => {
		if (typeof reply === "function") (reply as (value: ManagedSubagentService) => void)(service);
	});
	return () => {
		unsubscribe?.();
		if (installedService === service) installedService = undefined;
	};
}

export function getManagedSubagentService(
	events?: EventBus,
	options?: { processFallback?: boolean },
): ManagedSubagentService | undefined {
	let discovered: ManagedSubagentService | undefined;
	events?.emit(SERVICE_REQUEST_CHANNEL, (service: ManagedSubagentService) => {
		discovered ??= service;
	});
	return discovered ?? (options?.processFallback === false ? undefined : installedService);
}

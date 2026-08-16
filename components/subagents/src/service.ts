import type { Model } from "@earendil-works/pi-ai";
import type { EventBus, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentConfig, AgentRecord, ThinkingLevel } from "./types.js";

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
	internalOwner?: string;
	onStarted?: (agentId: string) => void;
	onAssistantUsage?: (usage: { input: number; output: number; cacheWrite: number }) => void;
	onCompaction?: (info: { reason: "manual" | "threshold" | "overflow"; tokensBefore: number }) => void;
}

export interface ManagedSubagentService {
	runFresh(ctx: ExtensionContext, request: ManagedAgentRequest): Promise<AgentRecord>;
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

export function getManagedSubagentService(events?: EventBus): ManagedSubagentService | undefined {
	let discovered: ManagedSubagentService | undefined;
	events?.emit(SERVICE_REQUEST_CHANNEL, (service: ManagedSubagentService) => {
		discovered ??= service;
	});
	return discovered ?? installedService;
}

import type { EventBus, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentRecord, AssistantUsageDelta, HarnessBoundedActivity } from "./types.js";

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

export interface ManagedBackgroundRun {
	id: string;
	completion: Promise<AgentRecord>;
	abort(): boolean;
}

export interface ManagedSubagentService {
	startBackground(ctx: ExtensionContext, request: ManagedBackgroundRequest): ManagedBackgroundRun;
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

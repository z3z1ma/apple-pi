import type { ThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { LifetimeUsage } from "./usage.js";

export type { ThinkingLevel };
export type SubagentType = string;
export const DEFAULT_AGENT_NAMES = ["general-purpose", "Explore", "Plan"] as const;

export interface AgentConfig {
	name: string;
	displayName?: string;
	color?: string;
	description: string;
	builtinToolNames?: string[];
	extSelectors?: string[];
	disallowedTools?: string[];
	extensions: true | string[] | false;
	excludeExtensions?: string[];
	skills: true | string[] | false;
	model?: string;
	thinking?: ThinkingLevel;
	maxTurns?: number;
	persistSession?: boolean;
	sessionDir?: string;
	allowedSubagents?: "all" | string[];
	/** Enable the costly continuous advisor inside this child session. Off unless explicitly requested. */
	advisor?: boolean;
	systemPrompt: string;
	promptMode: "replace" | "append";
	/** Omitted = bounded parent handoff; true = full parent branch; false = none. */
	inheritContext?: boolean;
	runInBackground?: boolean;
	isolated?: boolean;
	isDefault?: boolean;
	enabled?: boolean;
	source?: "default" | "project" | "global";
	sourcePath?: string;
}

export type JoinMode = "async" | "group" | "smart";
export type WidgetMode = "all" | "background" | "off";

export type AgentTerminationCause = "operator_stop" | "external_cancellation" | "token_ceiling" | "turn_ceiling" | "compaction" | "provider_error";

export interface AgentRecord {
	id: string;
	type: SubagentType;
	description: string;
	status: "queued" | "running" | "completed" | "steered" | "aborted" | "stopped" | "error";
	result?: string;
	error?: string;
	toolUses: number;
	startedAt: number;
	completedAt?: number;
	session?: AgentSession;
	/** Pi's authoritative child-session JSONL, when persistence is enabled. */
	sessionFile?: string;
	abortController?: AbortController;
	promise?: Promise<string>;
	groupId?: string;
	joinMode?: JoinMode;
	resultConsumed?: boolean;
	pendingSteers?: string[];
	toolCallId?: string;
	lifetimeUsage: LifetimeUsage;
	compactionCount: number;
	isBackground?: boolean;
	invocation?: AgentInvocation;
	depth?: number;
	parentAgentId?: string;
	maxSubagentDepth?: number;
	/** Internal orchestrator ownership; records with this marker are never publicly resumed or steered. */
	internalOwner?: string;
	/** Controller-owned termination attribution; absent for ordinary successful agents. */
	terminationCause?: AgentTerminationCause;
}

export interface AgentInvocation {
	modelName?: string;
	thinking?: ThinkingLevel;
	maxTurns?: number;
	isolated?: boolean;
	/** Omitted = bounded handoff; true = full parent branch; false = none. */
	inheritContext?: boolean;
	runInBackground?: boolean;
}

export interface NotificationDetails {
	id: string;
	description: string;
	status: string;
	toolUses: number;
	turnCount: number;
	maxTurns?: number;
	totalTokens: number;
	durationMs: number;
	error?: string;
	resultPreview: string;
	others?: NotificationDetails[];
}

export interface EnvInfo {
	isGitRepo: boolean;
	branch: string;
	platform: string;
}

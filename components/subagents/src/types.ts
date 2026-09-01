import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { LifetimeUsage } from "./usage.js";

export type ThinkingLevel = ModelThinkingLevel;
export type SubagentType = string;
export type SubagentConfigScope = Readonly<{ cwd: string; projectTrusted: boolean }>;
export const DEFAULT_AGENT_NAMES = ["explorer", "planner", "researcher", "consultant", "builder", "designer"] as const;

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
	/** User-global model profile name. Profiles select inference only, never capabilities. */
	profile?: string;
	maxTurns?: number;
	persistSession?: boolean;
	sessionDir?: string;
	/** Default pair programmer sidecar choice; an explicit invocation boolean overrides it. */
	pair?: boolean;
	allowedSubagents?: "all" | string[];
	systemPrompt: string;
	promptMode: "replace" | "append";
	isDefault?: boolean;
	enabled?: boolean;
	source?: "default" | "project" | "global";
	sourcePath?: string;
}

export type JoinMode = "async" | "group" | "smart";
export type WidgetMode = "all" | "background" | "off";

export type AgentTerminationCause =
	| "operator_stop"
	| "external_cancellation"
	| "token_ceiling"
	| "turn_ceiling"
	| "compaction"
	| "provider_error";

export interface AgentRecord {
	id: string;
	type: SubagentType;
	description: string;
	status: "queued" | "running" | "completed" | "steered" | "aborted" | "stopped" | "error";
	result?: string;
	error?: string;
	/** Absolute host-owned destination for the current invocation's final response. */
	outputPath?: string;
	/** Whether the current invocation's response reached outputPath. */
	outputWritten?: boolean;
	/** Stable assistant-message markers whose text must stay out of parent transcript snapshots. */
	persistedAssistantMessageMarkers?: string[];
	/** File-system failure from persisting the current invocation's final response. */
	outputWriteError?: string;
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
	/** Keep a settled in-memory session until the owning root session is disposed. */
	retainUntilSessionEnd?: boolean;
	/** Controller-owned termination attribution; absent for ordinary successful agents. */
	terminationCause?: AgentTerminationCause;
	/** Internal cleanup for a foreground caller signal when the run settles or becomes detached. */
	detachCallerSignal?: () => void;
	/** Immutable identity for the currently active invocation; retained through abort until it settles. */
	activeInvocation?: symbol;
	/** Immutable capacity lease for the currently active invocation. */
	capacityLease?: symbol;
	/** Turn policy captured at spawn, reused by every resume of this session. */
	maxTurns?: number;
	hardTurnLimit?: boolean;
}

export interface AgentInvocation {
	modelName?: string;
	profile?: string;
	/** Invocation-level system guidance appended to the selected definition. */
	systemPrompt?: string;
	thinking?: ThinkingLevel;
	maxTurns?: number;
	isolated?: boolean;
	/** Whether this invocation received the parent conversation. */
	inheritContext: boolean;
	/** Whether this invocation enabled the continuous pair. */
	pair: boolean;
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

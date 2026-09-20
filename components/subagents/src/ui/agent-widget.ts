/**
 * Persistent above-editor projection of active public subagents.
 *
 * The transcript owns terminal outcomes; this widget shows only running and queued work.
 */

import { Container, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { type ActiveWorkSource, ActiveWorkSurface } from "../../../shared/src/active-work.js";
import { renderAgentName } from "../agent-color.js";
import type { AgentManager } from "../agent-manager.js";
import { getConfig } from "../agent-types.js";
import type { AgentInvocation, AgentRecord, SubagentType } from "../types.js";
import { getLifetimeTotal, getSessionContextPercent, type LifetimeUsage, type SessionLike } from "../usage.js";

// ---- Constants ----

/** Braille spinner frames for animated running indicator. */
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Tool name → human-readable action for activity descriptions. */
const TOOL_DISPLAY: Record<string, string> = {
	read: "reading",
	bash: "running command",
	edit: "editing",
	write: "writing",
	grep: "searching",
	find: "finding files",
	ls: "listing",
};

// ---- Types ----

export type Theme = {
	fg(color: string, text: string): string;
	bold(text: string): string;
};

export function renderRunningAgentStatus(
	frame: string,
	stats: string,
	activity: string,
	theme: Pick<Theme, "fg">,
): Container {
	const container = new Container();
	container.addChild(new Text(theme.fg("accent", frame) + (stats ? ` ${stats}` : ""), 0, 0));
	container.addChild(new Text(theme.fg("dim", `  ⎿  ${activity}`), 0, 0));
	return container;
}

export type UICtx = {
	setStatus(key: string, text: string | undefined): void;
	setWidget(
		key: string,
		content: undefined | ((tui: any, theme: Theme) => { render(): string[]; invalidate(): void }),
		options?: { placement?: "aboveEditor" | "belowEditor" },
	): void;
};

/** Per-agent live activity state. */
export interface AgentActivity {
	activeTools: Map<string, string>;
	toolUses: number;
	responseText: string;
	session?: SessionLike;
	/** Current turn count. */
	turnCount: number;
	/** Effective max turns for this agent (undefined = unlimited). */
	maxTurns?: number;
	/** Lifetime usage breakdown — see LifetimeUsage docs. */
	lifetimeUsage: LifetimeUsage;
}

/** Metadata attached to agent tool results for custom rendering. */
export interface AgentDetails {
	displayName: string;
	description: string;
	subagentType: string;
	toolUses: number;
	tokens: string;
	durationMs: number;
	status: "queued" | "running" | "completed" | "steered" | "aborted" | "stopped" | "error" | "background";
	/** Human-readable description of what the agent is currently doing. */
	activity?: string;
	/** Current spinner frame index (for animated running indicator). */
	spinnerFrame?: number;
	/** Short model name if different from parent (e.g. "haiku", "sonnet"). */
	modelName?: string;
	/** Notable config tags (e.g. ["thinking: high", "isolated"]). */
	tags?: string[];
	/** Current turn count. */
	turnCount?: number;
	/** Effective max turns (undefined = unlimited). */
	maxTurns?: number;
	agentId?: string;
	/** Pi session JSONL used by search_session for this agent. */
	sessionFile?: string;
	error?: string;
}

// ---- Formatting helpers ----

/** Apply foreground styling while restoring it after nested foreground/full ANSI resets. */
export function fgPreservingNestedStyles(theme: Theme, color: string, text: string): string {
	const styledEmpty = theme.fg(color, "");
	const styleStart = styledEmpty.replace(/\u001b\[(?:0|39)m/g, "");
	return theme.fg(
		color,
		text.replace(/\u001b\[(?:0|39)m/g, (reset) => `${reset}${styleStart}`),
	);
}

/** Format a token count compactly: "33.8k token", "1.2M token". */
export function formatTokens(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M token`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k token`;
	return `${count} token`;
}

/**
 * Token count with optional context-fill % and compaction-count annotations.
 * Thresholds for percent: <70% dim, 70–85% warning, ≥85% error.
 * Compaction count rendered as `⇊N` in dim.
 *
 *   "12.3k token"               — no annotations
 *   "12.3k token (45%)"         — percent only
 *   "12.3k token (⇊2)"          — compactions only (e.g. right after compact)
 *   "12.3k token (45% · ⇊2)"    — both
 */
export function formatSessionTokens(tokens: number, percent: number | null, theme: Theme, compactions = 0): string {
	const tokenStr = formatTokens(tokens);
	const annot: string[] = [];
	if (percent !== null) {
		const color = percent >= 85 ? "error" : percent >= 70 ? "warning" : "dim";
		annot.push(theme.fg(color, `${Math.round(percent)}%`));
	}
	if (compactions > 0) {
		annot.push(theme.fg("dim", `⇊${compactions}`));
	}
	if (annot.length === 0) return tokenStr;
	return `${tokenStr} (${annot.join(" · ")})`;
}

/** Format turn count with optional max limit: "↻5≤30" or "↻5". */
export function formatTurns(turnCount: number, maxTurns?: number | null): string {
	return maxTurns != null ? `↻${turnCount}≤${maxTurns}` : `↻${turnCount}`;
}

/** Format milliseconds as human-readable duration. */
export function formatMs(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

/** Format duration from start/completed timestamps. */
export function formatDuration(startedAt: number, completedAt?: number): string {
	if (completedAt) return formatMs(completedAt - startedAt);
	return `${formatMs(Date.now() - startedAt)} (running)`;
}

/** Get display name for any agent type (built-in or custom). */
export function getDisplayName(type: SubagentType): string {
	return getConfig(type).displayName;
}

/** Short label for prompt mode: "twin" for append, nothing for replace (the default). */
export function getPromptModeLabel(type: SubagentType): string | undefined {
	const config = getConfig(type);
	return config.promptMode === "append" ? "twin" : undefined;
}

/** Mode label is not included — callers add it where they want it. */
export function buildInvocationTags(invocation: AgentInvocation | undefined): { modelName?: string; tags: string[] } {
	const tags: string[] = [];
	if (!invocation) return { tags };
	if (invocation.thinking) tags.push(`thinking: ${invocation.thinking}`);
	if (invocation.isolated) tags.push("isolated");
	if (invocation.inheritContext) tags.push("parent context");
	if (invocation.pair) tags.push("pair");
	if (invocation.runInBackground) tags.push("background");
	if (invocation.maxTurns != null) tags.push(`max turns: ${invocation.maxTurns}`);
	return { modelName: invocation.modelName, tags };
}

export function firstNonEmptyLine(text: string): string {
	return (
		text
			.split(/\r?\n/)
			.find((line) => line.trim())
			?.trim() ?? ""
	);
}

/** Truncate text to a single line, max `len` chars. */
function truncateLine(text: string, len = 60): string {
	const line = firstNonEmptyLine(text);
	if (line.length <= len) return line;
	return `${line.slice(0, len)}…`;
}

/** Build a human-readable activity string from currently-running tools or response text. */
export function describeActivity(activeTools: Map<string, string>, responseText?: string): string {
	if (activeTools.size > 0) {
		const groups = new Map<string, number>();
		for (const toolName of activeTools.values()) {
			const action = TOOL_DISPLAY[toolName] ?? toolName;
			groups.set(action, (groups.get(action) ?? 0) + 1);
		}

		const parts: string[] = [];
		for (const [action, count] of groups) {
			if (count > 1) {
				parts.push(`${action} ${count} ${action === "searching" ? "patterns" : "files"}`);
			} else {
				parts.push(action);
			}
		}
		return `${parts.join(", ")}…`;
	}

	// No tools active — show truncated response text if available
	if (responseText && responseText.trim().length > 0) {
		return truncateLine(responseText);
	}

	return "thinking…";
}

// ---- Active-work source ----

function activeAgents(manager: AgentManager): AgentRecord[] {
	return manager
		.listAgents()
		.filter(
			(agent) =>
				!agent.parentAgentId && !agent.internalOwner && (agent.status === "running" || agent.status === "queued"),
		);
}

function runningLines(
	agent: AgentRecord,
	activity: AgentActivity | undefined,
	frame: string,
	width: number,
	theme: Theme,
): string[] {
	const modeLabel = getPromptModeLabel(agent.type);
	const modeTag = modeLabel ? ` ${theme.fg("dim", `(${modeLabel})`)}` : "";
	const toolUses = activity?.toolUses ?? agent.toolUses;
	const tokens = getLifetimeTotal(activity?.lifetimeUsage ?? agent.lifetimeUsage);
	const contextPercent = getSessionContextPercent(activity?.session);
	const tokenText = tokens > 0 ? formatSessionTokens(tokens, contextPercent, theme, agent.compactionCount) : "";
	const stats = [
		activity ? formatTurns(activity.turnCount, activity.maxTurns) : "",
		toolUses > 0 ? `${toolUses} tool use${toolUses === 1 ? "" : "s"}` : "",
		tokenText,
		formatMs(Date.now() - agent.startedAt),
	]
		.filter(Boolean)
		.join(" · ");
	const currentActivity = activity ? describeActivity(activity.activeTools, activity.responseText) : "thinking…";
	return [
		truncateToWidth(
			theme.fg("dim", "├─") +
				` ${theme.fg("accent", frame)} ${renderAgentName(agent.type, theme, { bold: true })}${modeTag}  ${theme.fg("muted", firstNonEmptyLine(agent.description))} ${theme.fg("dim", "·")} ${fgPreservingNestedStyles(theme, "dim", stats)}`,
			width,
		),
		truncateToWidth(theme.fg("dim", "│  ") + theme.fg("dim", `  ⎿  ${currentActivity}`), width),
	];
}

function queuedLines(agent: AgentRecord, width: number, theme: Theme): string[] {
	const elapsed = formatMs(Date.now() - agent.startedAt);
	return [
		truncateToWidth(
			`${theme.fg("dim", "├─")} ${theme.fg("muted", "◦")} ${renderAgentName(agent.type, theme)}  ${theme.fg("muted", firstNonEmptyLine(agent.description))} ${theme.fg("dim", `· queued · ${elapsed}`)}`,
			width,
		),
	];
}

export function createAgentActiveWorkSource(
	manager: AgentManager,
	agentActivity: Map<string, AgentActivity>,
): ActiveWorkSource {
	return {
		key: "agents",
		statusKey: "subagents",
		countLabel: "agents",
		getEntries: () =>
			activeAgents(manager).map((agent) => ({
				id: agent.id,
				render: (width, theme, frame) =>
					agent.status === "running"
						? runningLines(agent, agentActivity.get(agent.id), frame, width, theme)
						: queuedLines(agent, width, theme),
			})),
	};
}

export class AgentWidget {
	private readonly unregister: () => void;

	constructor(
		manager: AgentManager,
		agentActivity: Map<string, AgentActivity>,
		private readonly surface = new ActiveWorkSurface(),
	) {
		this.unregister = this.surface.registerSource(createAgentActiveWorkSource(manager, agentActivity));
	}

	setUICtx(ctx: UICtx): void {
		this.surface.setUICtx(ctx);
	}

	update(): void {
		this.surface.update();
	}

	clearUI(): void {
		this.surface.clearUI();
	}

	dispose(): void {
		this.unregister();
	}
}

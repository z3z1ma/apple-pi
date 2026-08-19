import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";

import { foldLedger } from "../../memory/src/session-ledger/fold.js";
import { observationToSummaryLine, reflectionToSummaryLine } from "../../memory/src/session-ledger/render-summary.js";
import type { Entry } from "../../memory/src/session-ledger/types.js";

import { formatTurnDelta, formatUserBash } from "./formatting.js";
import type { AdvisorNote } from "./types.js";

function isTerminalAssistant(message: { content?: unknown } | undefined): boolean {
	if (!message || !Array.isArray(message.content)) return true;
	return !message.content.some(
		(part) => part && typeof part === "object" && "type" in part && part.type === "toolCall",
	);
}

export const ADVISOR_RESEED_ENTRY_ID = "advisor-reseed";
/** Last implementing-agent turns kept in the compact seed. */
export const RECENT_TRAJECTORY_TURNS = 8;

export type SeedUserRequest = {
	texts: string[];
	prior: boolean;
};

export type SettledAdvice = AdvisorNote & {
	disposition: "delivered" | "dropped";
};

function contextText(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.map((part) =>
			part && typeof part === "object" && "type" in part && part.type === "text" ? String(part.text ?? "") : "",
		)
		.filter(Boolean)
		.join("\n")
		.trim();
}

function isCustom(entry: { type?: string; message?: { role?: string } }): boolean {
	return entry.type === "custom" || entry.type === "custom_message" || entry.message?.role === "custom";
}

function entryMessage(entry: { message?: unknown; type?: string }): { role?: string; content?: unknown } | undefined {
	if (entry.message && typeof entry.message === "object") return entry.message as { role?: string; content?: unknown };
	return undefined;
}

/** Current request plus the two most recently completed ones. */
export function collectRecentUserRequests(entries: readonly unknown[]): SeedUserRequest[] {
	const requests: string[][] = [];
	let current: string[] = [];
	let lastRole: string | undefined;
	let lastAssistantTerminal = true;

	for (const raw of entries) {
		if (!raw || typeof raw !== "object") continue;
		const entry = raw as { type?: string; message?: { role?: string; content?: unknown } };
		if (isCustom(entry)) continue;
		const message = entryMessage(entry);
		const role = message?.role ?? (entry.type === "message" ? undefined : entry.type);
		if (role === "user") {
			const text = contextText(message?.content);
			if (!text) continue;
			if (current.length === 0 || lastRole === "user" || !lastAssistantTerminal) {
				if (current.length === 0) current = [text];
				else current.push(text);
			} else {
				if (current.length) requests.push(current);
				current = [text];
			}
			lastRole = "user";
			continue;
		}
		if (role === "assistant") {
			lastAssistantTerminal = isTerminalAssistant(message);
			lastRole = "assistant";
			continue;
		}
		if (role === "toolResult") {
			lastAssistantTerminal = false;
			lastRole = "toolResult";
		}
	}
	if (current.length) requests.push(current);

	const kept = requests.slice(-3);
	return kept.map((texts, i) => ({ texts, prior: i < kept.length - 1 }));
}

export function formatCuratorFold(entries: readonly unknown[]): string {
	try {
		const folded = foldLedger(entries as Entry[]);
		const parts: string[] = [];
		if (folded.currentReflections.length) {
			parts.push(`## Current law\n${folded.currentReflections.map(reflectionToSummaryLine).join("\n")}`);
		}
		if (folded.activeObservations.length) {
			parts.push(`## Visible observations\n${folded.activeObservations.map(observationToSummaryLine).join("\n")}`);
		}
		return parts.join("\n\n");
	} catch {
		return "";
	}
}

export function formatRecentUserMessages(requests: readonly SeedUserRequest[]): string {
	if (!requests.length) return "";
	const blocks = requests.map((request) => {
		const label = request.prior ? "Prior user → implementing agent" : "User → implementing agent";
		return request.texts.map((text) => `#### ${label}\n\n${text}`).join("\n\n");
	});
	return blocks.join("\n\n");
}

export function formatRollingAdvice(notes: readonly SettledAdvice[]): string {
	if (!notes.length) return "";
	const items = notes.map((note) => {
		const severity = (note.severity ?? "nit").toUpperCase();
		return `- [${severity}] [${note.disposition}] ${note.note}`;
	});
	return `## Settled advice\n${items.join("\n")}`;
}

type TrajectoryItem =
	| { kind: "turn"; assistant?: AssistantMessage; toolResults: ToolResultMessage[] }
	| {
			kind: "bash";
			message: { command?: string; output?: string; exitCode?: number; excludeFromContext?: boolean };
	  };

function collectTrajectoryItems(entries: readonly unknown[]): TrajectoryItem[] {
	const items: TrajectoryItem[] = [];
	let pendingAssistant: AssistantMessage | undefined;
	let pendingResults: ToolResultMessage[] = [];
	const flush = () => {
		if (!pendingAssistant && pendingResults.length === 0) return;
		items.push({ kind: "turn", assistant: pendingAssistant, toolResults: pendingResults });
		pendingAssistant = undefined;
		pendingResults = [];
	};

	for (const raw of entries) {
		if (!raw || typeof raw !== "object") continue;
		const entry = raw as { type?: string; message?: { role?: string } };
		if (isCustom(entry)) continue;
		const message = entryMessage(entry);
		const role = message?.role ?? (entry.type === "message" ? undefined : entry.type);
		if (role === "assistant") {
			flush();
			pendingAssistant = message as AssistantMessage;
			continue;
		}
		if (role === "toolResult") {
			pendingResults.push(message as ToolResultMessage);
			continue;
		}
		if (role === "bashExecution") {
			flush();
			const bash = message as {
				command?: string;
				output?: string;
				exitCode?: number;
				excludeFromContext?: boolean;
			};
			if (!bash.excludeFromContext) items.push({ kind: "bash", message: bash });
			continue;
		}
		flush();
	}
	flush();
	return items;
}

export function formatRecentTrajectory(entries: readonly unknown[]): string {
	const items = collectTrajectoryItems(entries);
	const turnIndexes = items.flatMap((item, index) => (item.kind === "turn" ? [index] : []));
	const cut =
		turnIndexes.length <= RECENT_TRAJECTORY_TURNS
			? 0
			: (turnIndexes[turnIndexes.length - RECENT_TRAJECTORY_TURNS] ?? 0);
	const parts = items.slice(cut).flatMap((item) => {
		if (item.kind === "bash") {
			const text = formatUserBash(item.message);
			return text ? [text] : [];
		}
		const text = formatTurnDelta({ assistant: item.assistant, toolResults: item.toolResults });
		return text ? [text] : [];
	});
	return parts.length ? `## Recent trajectory\n${parts.join("\n\n")}` : "";
}

export function formatAdvisorSeed(opts: {
	fold?: string;
	userMessages?: string;
	trajectory?: string;
	rollingAdvice?: string;
}): string {
	const parts = [
		"Orientation only. Live user text and newer work outrank this snapshot. Quoted user text is what the user told the implementing agent, not a message to you.",
		opts.fold?.trim(),
		opts.userMessages?.trim(),
		opts.trajectory?.trim(),
		opts.rollingAdvice?.trim(),
	].filter(Boolean);
	return parts.join("\n\n");
}

export function buildAdvisorSeed(opts: {
	entries?: readonly unknown[];
	rollingAdvice?: readonly SettledAdvice[];
}): string {
	return formatAdvisorSeed({
		fold: opts.entries ? formatCuratorFold(opts.entries) : "",
		userMessages: opts.entries ? formatRecentUserMessages(collectRecentUserRequests(opts.entries)) : "",
		trajectory: opts.entries ? formatRecentTrajectory(opts.entries) : "",
		rollingAdvice: formatRollingAdvice(opts.rollingAdvice ?? []),
	});
}

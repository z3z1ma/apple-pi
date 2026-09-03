import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";

import { foldLedger } from "../../notebook/src/session-ledger/fold.js";
import { observationToSummaryLine, reflectionToSummaryLine } from "../../notebook/src/session-ledger/render-summary.js";
import type { Entry } from "../../notebook/src/session-ledger/types.js";

import { formatTurnDelta, formatUserBash, formatUserMessage } from "./formatting.js";
import type { PairReceiptIssuer } from "./receipt-expansion.js";
import { isPairQuestion, type PairNote } from "./types.js";

function isTerminalAssistant(message: { content?: unknown } | undefined): boolean {
	if (!message || !Array.isArray(message.content)) return true;
	return !message.content.some(
		(part) => part && typeof part === "object" && "type" in part && part.type === "toolCall",
	);
}

export const PAIR_RESEED_ENTRY_ID = "pair-reseed";
/** Last implementing-agent turns kept in the compact seed. */
export const RECENT_TRAJECTORY_TURNS = 8;

export type SeedUserMessage = {
	content: unknown;
	sourceEntryId?: string;
};

export type SeedUserRequest = {
	prior: boolean;
	messages: SeedUserMessage[];
};

export type SettledAdvice = PairNote & {
	disposition: "delivered" | "dropped";
};

function isCustom(entry: { type?: string; message?: { role?: string } }): boolean {
	return entry.type === "custom" || entry.type === "custom_message" || entry.message?.role === "custom";
}

function entryMessage(entry: { message?: unknown; type?: string }): { role?: string; content?: unknown } | undefined {
	if (entry.message && typeof entry.message === "object") return entry.message as { role?: string; content?: unknown };
	return undefined;
}

/** Current request plus the two most recently completed ones. */
export function collectRecentUserRequests(entries: readonly unknown[]): SeedUserRequest[] {
	const requests: SeedUserMessage[][] = [];
	let current: SeedUserMessage[] = [];
	let lastRole: string | undefined;
	let lastAssistantTerminal = true;

	for (const raw of entries) {
		if (!raw || typeof raw !== "object") continue;
		const entry = raw as { id?: string; type?: string; message?: { role?: string; content?: unknown } };
		if (isCustom(entry)) continue;
		const message = entryMessage(entry);
		const role = message?.role ?? (entry.type === "message" ? undefined : entry.type);
		if (role === "user") {
			const content = message?.content;
			if (!formatUserMessage(content)) continue;
			const item: SeedUserMessage = {
				content,
				...(typeof entry.id === "string" && entry.id ? { sourceEntryId: entry.id } : {}),
			};
			if (current.length === 0 || lastRole === "user" || !lastAssistantTerminal) {
				current.push(item);
			} else {
				if (current.length) requests.push(current);
				current = [item];
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
	return kept.map((messages, i) => ({
		prior: i < kept.length - 1,
		messages,
	}));
}

export function formatNotebookFold(entries: readonly unknown[]): string {
	try {
		const folded = foldLedger(entries as Entry[]);
		const parts: string[] = [];
		if (folded.currentReflections.length) {
			parts.push(
				`## Current shared understanding\n${folded.currentReflections.map(reflectionToSummaryLine).join("\n")}`,
			);
		}
		if (folded.activeObservations.length) {
			parts.push(`## Working observations\n${folded.activeObservations.map(observationToSummaryLine).join("\n")}`);
		}
		return parts.join("\n\n");
	} catch {
		return "";
	}
}

export function formatRecentUserMessages(
	requests: readonly SeedUserRequest[],
	issueReceipt?: PairReceiptIssuer,
): string {
	if (!requests.length) return "";
	const blocks = requests.map((request) => {
		const label = request.prior ? "What the user previously told your partner" : "What the user told your partner";
		const bodies = request.messages.map((message) =>
			formatUserMessage(message.content, { issueReceipt, sourceEntryId: message.sourceEntryId }),
		);
		return bodies
			.filter(Boolean)
			.map((text) => `#### ${label}\n\n${text}`)
			.join("\n\n");
	});
	return blocks.join("\n\n");
}

export function formatRollingAdvice(notes: readonly SettledAdvice[]): string {
	if (!notes.length) return "";
	const items = notes.map((note) => {
		const label = isPairQuestion(note) ? "QUESTION" : (note.severity ?? "nit").toUpperCase();
		const outcome = note.disposition === "delivered" ? "shared" : "withdrawn";
		return `- [${label}] [${outcome}] ${note.note}`;
	});
	return `## Earlier notes\n${items.join("\n")}`;
}

type TrajectoryItem =
	| { kind: "turn"; assistant?: AssistantMessage; toolResults: ToolResultMessage[] }
	| {
			kind: "bash";
			sourceEntryId?: string;
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
		const entry = raw as { id?: string; type?: string; message?: { role?: string } };
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
			if (!bash.excludeFromContext) items.push({ kind: "bash", sourceEntryId: entry.id, message: bash });
			continue;
		}
		flush();
	}
	flush();
	return items;
}

export function formatRecentTrajectory(entries: readonly unknown[], issueReceipt?: PairReceiptIssuer): string {
	const items = collectTrajectoryItems(entries);
	const turnIndexes = items.flatMap((item, index) => (item.kind === "turn" ? [index] : []));
	const cut =
		turnIndexes.length <= RECENT_TRAJECTORY_TURNS
			? 0
			: (turnIndexes[turnIndexes.length - RECENT_TRAJECTORY_TURNS] ?? 0);
	const parts = items.slice(cut).flatMap((item) => {
		if (item.kind === "bash") {
			const text = formatUserBash(item.message, { issueReceipt, sourceEntryId: item.sourceEntryId });
			return text ? [text] : [];
		}
		const text = formatTurnDelta({ assistant: item.assistant, toolResults: item.toolResults, issueReceipt });
		return text ? [text] : [];
	});
	return parts.length ? `## What your partner has been doing\n${parts.join("\n\n")}` : "";
}

/**
 * Render the still-uncovered primary trajectory once for pair programmer session seeding.
 * Source ids remain attached while successful tool bodies use the same compact
 * receipts as live pair programmer review rather than submitting a second notebook transcript.
 */
export function formatSourceAddressedTrajectory(
	entries: readonly unknown[],
	allowedSourceEntryIds: readonly string[],
	issueReceipt?: PairReceiptIssuer,
): string {
	const allowed = new Set(allowedSourceEntryIds);
	const parts: string[] = [];
	let assistant: AssistantMessage | undefined;
	let toolResults: ToolResultMessage[] = [];
	let sourceIds: string[] = [];
	const labels = (ids: readonly string[]) => ids.map((id) => `[Source entry id: ${id}]`).join("\n");
	const flush = () => {
		if (!assistant && toolResults.length === 0) return;
		const text = formatTurnDelta({ assistant, toolResults, issueReceipt });
		if (text) parts.push(`${labels(sourceIds)}\n${text}`);
		assistant = undefined;
		toolResults = [];
		sourceIds = [];
	};

	for (const raw of entries) {
		if (!raw || typeof raw !== "object") continue;
		const entry = raw as {
			id?: string;
			type?: string;
			message?: { role?: string; content?: unknown };
			summary?: unknown;
		};
		if (!entry.id || !allowed.has(entry.id)) continue;
		const message = entryMessage(entry);
		const role = message?.role ?? (entry.type === "message" ? undefined : entry.type);
		if (role === "user") {
			flush();
			const text = formatUserMessage(message?.content, { issueReceipt, sourceEntryId: entry.id });
			if (text) parts.push(`${labels([entry.id])}\n#### What the user told your partner\n\n${text}`);
			continue;
		}
		if (role === "assistant") {
			flush();
			assistant = message as AssistantMessage;
			sourceIds.push(entry.id);
			continue;
		}
		if (role === "toolResult") {
			toolResults.push(message as ToolResultMessage);
			sourceIds.push(entry.id);
			continue;
		}
		if (role === "bashExecution") {
			flush();
			const text = formatUserBash(
				message as { command?: string; output?: string; exitCode?: number; excludeFromContext?: boolean },
				{ issueReceipt, sourceEntryId: entry.id },
			);
			if (text) parts.push(`${labels([entry.id])}\n${text}`);
			continue;
		}
		if (entry.type === "branch_summary" && typeof entry.summary === "string") {
			flush();
			parts.push(`${labels([entry.id])}\n#### Branch summary\n\n${entry.summary}`);
		}
	}
	flush();
	return parts.length > 0 ? `## Notebook material you have not reviewed yet\n${parts.join("\n\n")}` : "";
}

export function formatPairSeed(opts: {
	fold?: string;
	userMessages?: string;
	trajectory?: string;
	unresolvedNotebook?: string;
	rollingAdvice?: string;
}): string {
	const parts = [
		"Here is where you and your partner left off. Live user direction and newer work take precedence over this snapshot. Quoted user text was addressed to your partner, not to you.",
		opts.fold?.trim(),
		opts.userMessages?.trim(),
		opts.trajectory?.trim(),
		opts.unresolvedNotebook?.trim(),
		opts.rollingAdvice?.trim(),
	].filter(Boolean);
	return parts.join("\n\n");
}

export function buildPairSeed(opts: {
	entries?: readonly unknown[];
	rollingAdvice?: readonly SettledAdvice[];
	unresolvedNotebook?: string;
	issueReceipt?: PairReceiptIssuer;
	/** Default true. Compact reseeds omit the fold; the parent packet carries it. */
	includeFold?: boolean;
}): string {
	const includeFold = opts.includeFold !== false;
	return formatPairSeed({
		fold: includeFold && opts.entries ? formatNotebookFold(opts.entries) : "",
		userMessages: opts.entries
			? formatRecentUserMessages(collectRecentUserRequests(opts.entries), opts.issueReceipt)
			: "",
		trajectory: opts.entries ? formatRecentTrajectory(opts.entries, opts.issueReceipt) : "",
		unresolvedNotebook: opts.unresolvedNotebook,
		rollingAdvice: formatRollingAdvice(opts.rollingAdvice ?? []),
	});
}

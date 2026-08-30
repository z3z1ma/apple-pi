import { randomUUID } from "node:crypto";

import type { PairNote, PairSeverity } from "./types.js";

export const PAIR_FINDING_ACKNOWLEDGED = "pair.finding.acknowledged";
export const PAIR_FINDING_UNACKNOWLEDGED = "pair.finding.unacknowledged";
export const PAIR_ACK_REMINDER_TYPE = "pair-ack-reminder";

export type PairFindingDisposition = "address" | "decline" | "defer";

export type PairFindingAcknowledgment = {
	id: string;
	disposition: PairFindingDisposition;
	reason: string;
};

export type PendingPairFinding = {
	id: string;
	note: string;
	severity: Extract<PairSeverity, "concern" | "blocker">;
	source: "pair" | "advisor";
	deliveredTurn: number;
	reminderTurn?: number;
};

export function pairFindingId(): string {
	return `pair-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

export function identifyMaterialPairNotes(notes: readonly PairNote[]): PairNote[] {
	return notes.map((note) =>
		note.severity === "concern" || note.severity === "blocker"
			? { ...note, id: note.id ?? pairFindingId() }
			: { ...note },
	);
}

export function formatPairAcknowledgmentReminder(findings: readonly PendingPairFinding[]): string {
	const items = findings
		.map((finding) => `- ${finding.id} [${finding.severity.toUpperCase()}] ${finding.note}`)
		.join("\n");
	return [
		"<pair-ack-reminder>",
		"These material Pair findings still need a recorded disposition:",
		items,
		"Call `acknowledge_pair_findings` with `address`, `decline`, or `defer` and a concise reason for each id. This records consideration only; it does not claim the work is fixed or validated.",
		"</pair-ack-reminder>",
	].join("\n");
}

export class PairAcknowledgmentTracker {
	#turn = 0;
	#pending = new Map<string, PendingPairFinding>();

	get pendingCount(): number {
		return this.#pending.size;
	}

	advanceTurn(): number {
		return ++this.#turn;
	}

	recordDelivered(notes: readonly PairNote[]): void {
		for (const note of notes) {
			if (!note.id || (note.severity !== "concern" && note.severity !== "blocker")) continue;
			const current = this.#pending.get(note.id);
			this.#pending.set(note.id, {
				id: note.id,
				note: note.note,
				severity: note.severity,
				source: note.source === "advisor" ? "advisor" : "pair",
				deliveredTurn: current?.deliveredTurn ?? this.#turn,
				...(current?.reminderTurn === undefined ? {} : { reminderTurn: current.reminderTurn }),
			});
		}
	}

	get(id: string): PendingPairFinding | undefined {
		const finding = this.#pending.get(id);
		return finding ? { ...finding } : undefined;
	}

	validate(items: readonly PairFindingAcknowledgment[]): string[] {
		const errors: string[] = [];
		const seen = new Set<string>();
		for (const item of items) {
			if (seen.has(item.id)) errors.push(`duplicate finding id: ${item.id}`);
			seen.add(item.id);
			if (!this.#pending.has(item.id)) errors.push(`unknown or already closed finding id: ${item.id}`);
			if (!item.reason.trim()) errors.push(`finding ${item.id} requires a concise reason`);
		}
		return errors;
	}

	resolve(id: string): PendingPairFinding | undefined {
		const finding = this.#pending.get(id);
		if (finding) this.#pending.delete(id);
		return finding ? { ...finding } : undefined;
	}

	terminalActions(): { remind: PendingPairFinding[]; close: PendingPairFinding[] } {
		const remind: PendingPairFinding[] = [];
		const close: PendingPairFinding[] = [];
		for (const finding of this.#pending.values()) {
			if (finding.deliveredTurn >= this.#turn) continue;
			if (finding.reminderTurn === undefined) remind.push({ ...finding });
			else if (finding.reminderTurn < this.#turn) close.push({ ...finding });
		}
		return { remind, close };
	}

	markReminded(ids: readonly string[]): void {
		for (const id of ids) {
			const finding = this.#pending.get(id);
			if (finding && finding.reminderTurn === undefined) finding.reminderTurn = this.#turn;
		}
	}

	reset(): void {
		this.#turn = 0;
		this.#pending.clear();
	}
}

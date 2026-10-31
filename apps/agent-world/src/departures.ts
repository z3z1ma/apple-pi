import type { ReceiptStage } from "./world.js";

export interface RetirePeopleRequest {
	id: string;
	reason: string;
	people: { person: string; handoff: boolean }[];
}

export interface RetirePersonProgress {
	person: string;
	state: "pending" | "blocked" | "uncertain" | ReceiptStage;
	reason?: string;
}

export interface RetirePeopleProgress {
	id: string;
	people: RetirePersonProgress[];
	finished: boolean;
}

export function isRetirePeopleRequest(value: unknown): value is RetirePeopleRequest {
	if (typeof value !== "object" || value === null) return false;
	const request = value as Record<string, unknown>;
	if (
		typeof request.id !== "string" ||
		!request.id.trim() ||
		typeof request.reason !== "string" ||
		!request.reason.trim()
	)
		return false;
	if (!Array.isArray(request.people) || !request.people.length) return false;
	return (
		request.people.every(
			(item) =>
				typeof item === "object" &&
				item !== null &&
				typeof item.person === "string" &&
				!!item.person.trim() &&
				typeof item.handoff === "boolean",
		) && new Set(request.people.map((item) => item.person)).size === request.people.length
	);
}

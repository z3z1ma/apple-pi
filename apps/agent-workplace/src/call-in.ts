import type { ReceiptStage } from "./world.js";

export interface CallInRequest {
	id: string;
	person: string;
	expected: string[];
}
export interface CallInPerson {
	person: string;
	state: "ready" | "active" | "failed" | "uncertain" | "blocked";
	stage?: ReceiptStage;
	commandId?: string;
	reason?: string;
}
export interface CallInResult {
	ok: boolean;
	people: CallInPerson[];
	reason?: string;
}
export function isCallInRequest(value: unknown): value is CallInRequest {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const request = value as Record<string, unknown>;
	return (
		typeof request.id === "string" &&
		request.id.trim().length > 0 &&
		typeof request.person === "string" &&
		request.person.trim().length > 0 &&
		Array.isArray(request.expected) &&
		request.expected.length > 0 &&
		request.expected.every((id) => typeof id === "string" && id.trim().length > 0) &&
		new Set(request.expected).size === request.expected.length &&
		request.expected.includes(request.person)
	);
}

export interface OrgMoveRequest {
	person: string;
	manager: string | null;
	branch: string[];
}

export type OrgMoveResult = ({ ok: true } & OrgMoveRequest) | { ok: false; reason: string; tasks?: string[] };

export interface OrgStartPosition {
	id: string;
	role?: string;
	name?: string;
	person?: string;
	manager: string | null;
	goal?: string;
}

export interface OrgStartRequest {
	id: string;
	cwd: string;
	goal: string;
	positions: OrgStartPosition[];
	withReady?: boolean;
}

export interface OrgStartPerson {
	id: string;
	person?: string;
	state: "pending" | "preparing" | "ready" | "active" | "uncertain" | "failed" | "blocked";
	reason?: string;
	tasks?: string[];
	atHome?: boolean;
}

export interface OrgStartProgress {
	id: string;
	people: OrgStartPerson[];
	channel?: string;
	kickoff?: { thread: string; commandId: string };
	readiness?: { thread: string; commandId: string };
	complete: boolean;
	editable?: boolean;
	next: "working" | "retry" | "choose-ready" | "done";
	note?: string;
}

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function isOrgMoveRequest(value: unknown): value is OrgMoveRequest {
	return (
		object(value) &&
		typeof value.person === "string" &&
		(value.manager === null || typeof value.manager === "string") &&
		Array.isArray(value.branch) &&
		value.branch.every((id) => typeof id === "string")
	);
}

export function isOrgStartRequest(value: unknown): value is OrgStartRequest {
	return (
		object(value) &&
		typeof value.id === "string" &&
		typeof value.cwd === "string" &&
		typeof value.goal === "string" &&
		(value.withReady === undefined || typeof value.withReady === "boolean") &&
		Array.isArray(value.positions) &&
		value.positions.every(
			(position) =>
				object(position) &&
				typeof position.id === "string" &&
				(position.manager === null || typeof position.manager === "string") &&
				[position.role, position.name, position.person, position.goal].every(
					(field) => field === undefined || typeof field === "string",
				),
		)
	);
}

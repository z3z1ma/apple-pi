import { randomUUID } from "node:crypto";
import type { BeforeAgentStartEvent } from "@earendil-works/pi-coding-agent";

export interface RunInput {
	kind: "user" | "custom" | "mail" | "program" | "unknown";
	command: string | null;
	thread?: string;
	message?: string;
}
export interface RunSnapshot {
	id: string | null;
	active: boolean;
	input: RunInput;
	mailReceived: boolean;
}
export type RunObservation =
	| ({ phase: "prepare" | "start" | "resume" } & RunSnapshot)
	| { phase: "input"; id: string; input: RunInput }
	| { phase: "settle"; id: string; aborted: boolean }
	| { phase: "break"; id: string | null };

const UNKNOWN: RunInput = { kind: "unknown", command: null };

/** Deliberately select typed identifiers: prompts, custom-message bodies and arbitrary details stay private. */
export function runInput(message: unknown): RunInput {
	if (!message || typeof message !== "object") return UNKNOWN;
	const value = message as { role?: string; customType?: string; details?: Record<string, unknown> };
	if (value.role === "user") return { kind: "user", command: null };
	if (value.customType === "apple-pi.mailbox-message") {
		const details = value.details;
		const reference = details?.reference as { id?: unknown } | undefined;
		return {
			kind: "mail",
			command: typeof details?.id === "string" ? details.id : null,
			...(typeof details?.thread === "string" ? { thread: details.thread } : {}),
			...(typeof reference?.id === "string" ? { message: reference.id } : {}),
		};
	}
	if (value.customType === "organization.program-request")
		return { kind: "program", command: typeof value.details?.requestId === "string" ? value.details.requestId : null };
	return { kind: value.role === "custom" || value.customType ? "custom" : "unknown", command: null };
}

interface ActiveRun extends RunSnapshot {
	consumed: Set<string>;
}
const RUNS = Symbol.for("apple-pi.session-state.observed-runs");
function activeRuns() {
	const global = globalThis as Record<symbol, Map<string, ActiveRun> | undefined>;
	global[RUNS] ??= new Map();
	return global[RUNS];
}

/** Process-local identity survives extension reload only; journal snapshots make every reconnect explicit. */
export class RunObserver {
	private run?: ActiveRun;
	private readonly person: string;
	private readonly emit: (observation: RunObservation) => void;
	constructor(person: string, reload: boolean, idle: boolean, emit: (observation: RunObservation) => void) {
		this.person = person;
		this.emit = emit;
		this.run = reload && !idle ? activeRuns().get(person) : undefined;
		if (!this.run && !idle)
			this.run = { id: randomUUID(), active: true, input: UNKNOWN, mailReceived: false, consumed: new Set() };
		this.retain();
	}
	private retain() {
		if (this.run) activeRuns().set(this.person, this.run);
		else activeRuns().delete(this.person);
	}
	snapshot(): RunSnapshot {
		const { id, active, input, mailReceived } = this.run ?? {
			id: null,
			active: false,
			input: UNKNOWN,
			mailReceived: false,
		};
		return { id, active, input, mailReceived };
	}
	prepare(event: BeforeAgentStartEvent) {
		this.run = {
			id: randomUUID(),
			active: false,
			input: event.messageType === "user" ? { kind: "user", command: null } : runInput(event.message),
			mailReceived: false,
			consumed: new Set(),
		};
		this.retain();
		this.emit({ phase: "prepare", ...this.snapshot() });
	}
	start() {
		if (this.run?.active) return;
		this.run ??= { id: randomUUID(), active: false, input: UNKNOWN, mailReceived: false, consumed: new Set() };
		this.run.active = true;
		this.retain();
		this.emit({ phase: "start", ...this.snapshot() });
	}
	consume(message: unknown) {
		const input = runInput(message);
		if (!this.run?.active || (input.kind !== "mail" && input.kind !== "program")) return;
		if (input.command && this.run.consumed.has(input.command)) return;
		if (input.command) this.run.consumed.add(input.command);
		if (input.kind === "mail") this.run.mailReceived = true;
		this.emit({ phase: "input", id: this.run.id!, input });
	}
	settle(aborted: boolean) {
		const id = this.run?.id;
		this.run = undefined;
		this.retain();
		if (id) this.emit({ phase: "settle", id, aborted });
	}
	close(reload: boolean) {
		this.emit({ phase: "break", id: this.run?.id ?? null });
		if (!reload) {
			this.run = undefined;
			this.retain();
		}
	}
}

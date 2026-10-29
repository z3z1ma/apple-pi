import { DatabaseSync } from "node:sqlite";
import { departureOf } from "../../../../components/session-state/src/departures.js";
import { temporaryCallers } from "../../../../components/session-state/src/program-peers.js";
import { type CallInPerson, type CallInRequest, type CallInResult, isCallInRequest } from "../call-in.js";
import type { CommandReceipt, ReceiptStage } from "../world.js";
import { operatorPane, type WakePane } from "./inn.js";

interface Person {
	id: string;
	reports_to: string | null;
	retired_at: number | null;
	run_state: string;
	started_at: number | null;
	ended_at: number | null;
	process_state: string | null;
}
interface Start {
	command_id: string;
	stage: ReceiptStage;
	reason: string | null;
}
const awake = (person: Person) =>
	person.started_at !== null && person.ended_at === null && person.process_state === "alive";
const ready = (person: Person): CallInPerson => ({
	person: person.id,
	state: person.run_state === "idle" ? "ready" : "active",
});
const prefix = (id: string, person: string) => `call-in:${encodeURIComponent(id)}:${encodeURIComponent(person)}:`;
const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function personIn(db: DatabaseSync, id: string): Person | undefined {
	return db
		.prepare(`select s.id, s.reports_to, s.retired_at, s.run_state,
		i.started_at, i.ended_at, i.process_state from sessions s left join incarnations i
		on i.session_id = s.id and i.generation = s.generation where s.id = ? and s.kind = 'root'`)
		.get(id) as unknown as Person | undefined;
}

function consent(people: Person[], expected: string[]): void {
	const extra = people.find((person) => !awake(person) && !expected.includes(person.id));
	if (extra) throw new Error(`The preview changed: ${extra.id} would also be called in. Review it again.`);
}

function chain(db: DatabaseSync, request: CallInRequest): Person[] {
	const temporary = temporaryCallers(db);
	const people: Person[] = [];
	const visited = new Set<string>();
	let id: string | null = request.person;
	while (id) {
		if (visited.has(id)) throw new Error("The reporting chain contains a cycle.");
		visited.add(id);
		const person = personIn(db, id);
		if (!person) throw new Error(`The reporting chain is missing ${id}.`);
		if (person.retired_at !== null || departureOf(db, id)) throw new Error(`Former person ${id} cannot be called in.`);
		if (temporary.has(id)) throw new Error(`Temporary person ${id} cannot be called in.`);
		people.push(person);
		id = person.reports_to;
	}
	if (request.expected.some((expected) => !visited.has(expected)))
		throw new Error("The reporting chain changed. Review the call-in preview again.");
	return people.reverse();
}

function starts(db: DatabaseSync, person: string): Start[] {
	return db
		.prepare(
			"select command_id, stage, reason from commands where session_id = ? and kind = 'start' order by created_at, rowid",
		)
		.all(person) as unknown as Start[];
}

function unsettled(person: Person, history: Start[]): CallInPerson | undefined {
	if (awake(person)) return;
	const pending = history.findLast((start) => start.stage === "accepted" || start.stage === "delivered");
	if (pending)
		return {
			person: person.id,
			state: "uncertain",
			stage: pending.stage,
			commandId: pending.command_id,
			reason: "A previous start has not reconciled. Wait for it or inspect its receipt before retrying.",
		};
	if (person.started_at !== null && person.ended_at === null)
		return {
			person: person.id,
			state: "uncertain",
			reason: "The current process has lost its bridge; reconcile it before another start.",
		};
}

export function openCallIn(
	path: string,
	wake: (person: string, commandId: string, pane: WakePane) => Promise<CommandReceipt>,
): (request: CallInRequest) => Promise<CallInResult> {
	const running = new Map<string, { signature: string; result: Promise<CallInResult> }>();
	const read = <T>(operation: (db: DatabaseSync) => T): T => {
		const db = new DatabaseSync(path, { readOnly: true });
		try {
			return operation(db);
		} finally {
			db.close();
		}
	};
	async function execute(request: CallInRequest): Promise<CallInResult> {
		let people: CallInPerson[] = request.expected.map((person) => ({ person, state: "blocked" }));
		const complete = (ok: boolean, reason?: string): CallInResult => {
			const joined = people.filter((person) => person.state === "ready" || person.state === "active");
			try {
				if (joined.length)
					read((db) => {
						for (const outcome of joined) {
							const current = personIn(db, outcome.person);
							if (current && current.retired_at === null && awake(current)) Object.assign(outcome, ready(current));
							else Object.assign(outcome, { state: "uncertain", reason: "The person is no longer connected." });
						}
					});
			} catch (error) {
				for (const outcome of joined) Object.assign(outcome, { state: "uncertain", reason: reasonOf(error) });
			}
			const uncertain = joined.find((person) => person.state === "uncertain");
			return { ok: ok && !uncertain, people, ...(reason || uncertain ? { reason: reason ?? uncertain?.reason } : {}) };
		};
		const reject = (reason: string): CallInResult => complete(false, reason);
		try {
			const original = read((db) => chain(db, request));
			people = read((db) =>
				original
					.filter((person) => request.expected.includes(person.id))
					.map((person): CallInPerson => {
						const previous = starts(db, person.id)
							.filter((start) => start.command_id.startsWith(prefix(request.id, person.id)))
							.at(-1);
						return {
							...(awake(person) ? ready(person) : { person: person.id, state: "blocked" as const }),
							...(previous ? { commandId: previous.command_id, stage: previous.stage } : {}),
						};
					}),
			);
			const uncertainty = read((db) =>
				original.map((person) => unsettled(person, starts(db, person.id))).find(Boolean),
			);
			if (uncertainty) {
				people = people.map((person) => (person.person === uncertainty.person ? uncertainty : person));
				return reject(uncertainty.reason!);
			}
			consent(original, request.expected);
			if (original.every(awake)) return complete(true);
			const pane = await operatorPane(path);
			if (!pane) return reject("No terminal is attached to tmux, so there is nowhere to open these sessions.");
			for (const outcome of people) {
				const current = read((db) => chain(db, request));
				consent(current, request.expected);
				if (current.map((person) => person.id).join("\0") !== original.map((person) => person.id).join("\0"))
					return reject("Reporting changed during call-in. Review the preview again.");
				const index = current.findIndex((person) => person.id === outcome.person);
				const person = current[index]!;
				if (current.slice(0, index).some((parent) => !awake(parent)))
					return reject("A manager is no longer connected. Remaining people were not called in.");
				if (awake(person)) {
					Object.assign(outcome, ready(person));
					continue;
				}
				const history = read((db) => starts(db, person.id));
				const uncertain = unsettled(person, history);
				if (uncertain) {
					Object.assign(outcome, uncertain);
					return reject(uncertain.reason!);
				}
				const attempts = history.filter((start) => start.command_id.startsWith(prefix(request.id, person.id)));
				const completed = attempts.find((start) => start.stage === "applied");
				if (completed) {
					Object.assign(outcome, {
						state: "uncertain",
						stage: completed.stage,
						commandId: completed.command_id,
						reason: "This call-in already completed, but the person has since stopped. Start a new call-in request.",
					});
					return reject(outcome.reason!);
				}
				const commandId = `${prefix(request.id, person.id)}${attempts.length + 1}`;
				Object.assign(outcome, { commandId, state: "uncertain", reason: "The start has not reconciled yet." });
				let receipt: CommandReceipt;
				try {
					receipt = await wake(person.id, commandId, pane);
				} catch (error) {
					receipt = { ok: false, reason: reasonOf(error) };
				}
				const latest = read((db) => ({
					person: personIn(db, person.id),
					record: starts(db, person.id).find((start) => start.command_id === commandId),
				}));
				const stage = latest.record?.stage ?? (receipt.ok ? receipt.stage : undefined);
				if (latest.person && awake(latest.person))
					Object.assign(outcome, ready(latest.person), { stage, reason: undefined });
				else {
					Object.assign(outcome, {
						state: stage === "failed" ? "failed" : "uncertain",
						stage,
						reason:
							latest.record?.reason ??
							(receipt.ok ? "No connected incarnation is visible after this start." : receipt.reason),
					});
					return reject(outcome.reason!);
				}
			}
			return complete(true);
		} catch (error) {
			return reject(reasonOf(error));
		}
	}
	return (input) => {
		if (!isCallInRequest(input))
			return Promise.resolve({
				ok: false,
				people: [],
				reason: "A call-in identity, selected person and confirmed people are required.",
			});
		const request = { id: input.id, person: input.person, expected: [...input.expected] };
		const signature = JSON.stringify([request.person, [...request.expected].sort()]);
		const previous = running.get(request.id);
		if (previous)
			return previous.signature === signature
				? previous.result
				: Promise.resolve({
						ok: false,
						people: [],
						reason: "This call-in is already running with a different preview.",
					});
		const result = execute(request).finally(() => running.delete(request.id));
		running.set(request.id, { signature, result });
		return result;
	};
}

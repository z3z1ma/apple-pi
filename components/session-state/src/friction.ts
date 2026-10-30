import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { departedPeople } from "./departures.js";
import { membership } from "./fitness.js";
import { waitsIn } from "./inspect.js";
import { WAITS } from "./links.js";
import { OPERATOR } from "./threads.js";
import { rootOf } from "./tree.js";

export interface FrictionNotice {
	key: string;
	organization: string;
	recipient: string;
	kind: "wait_cycle" | "blocked_fan_in" | "discussion_wait";
	anchor: string;
	body: string;
}
interface Person {
	id: string;
	reports_to: string | null;
	role: string | null;
	manages: number;
	retired_at: number | null;
}
type Wait = ReturnType<typeof waitsIn>["targets"][number]["waits"][number];

type FrictionIdentity = Pick<FrictionNotice, "key" | "organization">;
export interface FrictionChanges {
	raised: FrictionNotice[];
	cleared: FrictionIdentity[];
}

/** Plan publication against the journal; observing a pattern does not acknowledge its delivery. */
export function frictionIn(db: DatabaseSync): FrictionChanges {
	const active = new Map<string, FrictionIdentity>();
	const records = db
		.prepare("select type, data from events where type in ('friction_raised', 'friction_cleared') order by seq")
		.all() as { type: string; data: string }[];
	for (const record of records) {
		const identity = JSON.parse(record.data) as FrictionIdentity;
		if (record.type === "friction_raised") active.set(identity.key, identity);
		else active.delete(identity.key);
	}
	const current = detectFriction(db);
	const keys = new Set(current.map((notice) => notice.key));
	return {
		raised: current.filter((notice) => !active.has(notice.key)),
		cleared: [...active.values()]
			.filter((notice) => !keys.has(notice.key))
			.map(({ key, organization }) => ({ key, organization })),
	};
}

/** Current recorded coordination patterns, not inactivity scores, diagnoses or instructions. */
function detectFriction(db: DatabaseSync): FrictionNotice[] {
	const people = db
		.prepare("select id, reports_to, role, manages, retired_at from sessions where kind = 'root'")
		.all() as unknown as Person[];
	const parents = new Map(people.map((person) => [person.id, person.reports_to]));
	for (const [id, person] of departedPeople(db)) if (!parents.has(id)) parents.set(id, person.reportsTo);
	const roots = new Set(people.filter((person) => person.retired_at === null).map((person) => rootOf(db, person.id)));
	const candidates = waitingOrganizations(db, roots);
	if (!candidates.size) return [];
	const assignments = db.prepare("select person, task_id from assignments where ended_at is null").all() as {
		person: string;
		task_id: string;
	}[];
	const notices: FrictionNotice[] = [];
	for (const organization of roots) {
		if (!candidates.has(organization)) continue;
		// All committed transitions, not a forecast. Elapsed-age fields are deliberately unused.
		const snapshot = Number.POSITIVE_INFINITY;
		const { isMember } = membership(db, organization).replay(snapshot);
		const members = new Map(
			people.filter((person) => person.retired_at === null && isMember(person.id)).map((person) => [person.id, person]),
		);
		const waits = waitsIn(db, organization, { cwd: "", to: snapshot }).targets.flatMap((target) => target.waits);
		const owners = (ref: string): string[] =>
			ref.startsWith("person:")
				? [ref.slice(7)].filter((person) => members.has(person))
				: ref.startsWith("task:")
					? assignments
							.filter((assignment) => assignment.task_id === ref.slice(5) && members.has(assignment.person))
							.map((assignment) => assignment.person)
					: [];
		const parties = (wait: Wait) =>
			[...wait.waiters.map((ref) => ref.slice(7)), ...owners(wait.to)].filter((person) => members.has(person));
		const path = (person: string) => {
			const chain: string[] = [];
			for (let at: string | null = person; at && !chain.includes(at); at = parents.get(at) ?? null) chain.push(at);
			return chain;
		};
		const recipientFor = (participants: string[]): string | undefined => {
			const chains = [...new Set(participants)].filter((person) => members.has(person)).map(path);
			if (!chains.length) return undefined;
			const common = chains[0].find((person) => chains.every((chain) => chain.includes(person)));
			if (common)
				for (const id of path(common)) {
					const person = members.get(id);
					if (person && (person.manages === 1 || (person.role === null && person.reports_to === null))) return id;
				}
			return OPERATOR;
		};
		const add = (
			kind: FrictionNotice["kind"],
			identity: string[],
			anchor: string,
			related: Wait[],
			body: string,
			authors: string[] = [],
		) => {
			const recipient = recipientFor([...related.flatMap(parties), ...authors]);
			if (!recipient) return;
			const key = createHash("sha256")
				.update(JSON.stringify([organization, recipient, kind, identity]))
				.digest("hex");
			notices.push({
				key,
				organization,
				recipient,
				kind,
				anchor,
				body: `${body}\nThis records a coordination pattern, not a diagnosis or a recommended intervention. Inspect org_waits and the referenced task/thread before deciding what to do.`,
			});
		};
		const incoming = new Map<string, Wait[]>();
		const outgoing = new Map<string, Wait[]>();
		for (const wait of waits) {
			incoming.set(wait.to, [...(incoming.get(wait.to) ?? []), wait]);
			outgoing.set(wait.from, [...(outgoing.get(wait.from) ?? []), wait]);
		}
		for (const component of waitComponents(waits)) {
			const nodes = new Set(component);
			const cycle = waits.filter((wait) => nodes.has(wait.from) && nodes.has(wait.to));
			if (component.length === 1 && !cycle.some((wait) => wait.from === wait.to)) continue;
			const anchor = cycle[0];
			add(
				"wait_cycle",
				component.sort(),
				anchor.ref,
				cycle,
				`Open wait cycle: ${component.length} references connected by ${cycle.length} recorded waits. One edge is ${anchor.from} -> ${anchor.to} (${anchor.ref}). A recorded cycle is not proof that every participant is unable to make progress.`,
			);
		}
		for (const [target, sources] of incoming) {
			const continuation = outgoing.get(target) ?? [];
			const from = new Set(sources.map((wait) => wait.from));
			const holders = new Set(sources.flatMap((wait) => owners(wait.from)));
			if (from.size < 2 || holders.size < 2 || !continuation.length) continue;
			add(
				"blocked_fan_in",
				[target],
				sources[0].ref,
				[...sources, ...continuation],
				`${from.size} waiting references involving ${holders.size} people converge on ${target}; that reference itself has ${continuation.length} open waits. Start with ${sources[0].ref}. This is a dependency-chain observation, not evidence that its owner is underused or overloaded.`,
			);
		}
		for (const wait of waits) {
			const dependents = incoming.get(wait.from) ?? [];
			if (wait.relation !== "requires_decision" || !wait.from.startsWith("task:") || !dependents.length) continue;
			const task = db.prepare("select thread from work_tasks where id = ?").get(wait.from.slice(5)) as
				| { thread: string }
				| undefined;
			if (!task) continue;
			const { created_at: since } = db.prepare("select created_at from links where id = ?").get(wait.ref.slice(5)) as {
				created_at: number;
			};
			const messages = db
				.prepare("select sender from thread_messages where thread_id = ? and at >= ? order by seq")
				.all(task.thread, since) as { sender: string }[];
			const seen = new Set<string>();
			const returned = new Set<string>();
			let previous: string | undefined;
			for (const { sender } of messages) {
				if ((!members.has(sender) && sender !== OPERATOR) || sender === previous) continue;
				if (seen.has(sender)) returned.add(sender);
				seen.add(sender);
				previous = sender;
			}
			if (returned.size < 2) continue;
			const { count } = db
				.prepare("select count(*) as count from thread_participants where thread_id = ?")
				.get(task.thread) as { count: number };
			add(
				"discussion_wait",
				[wait.ref],
				wait.ref,
				[wait, ...dependents],
				`${wait.ref} (${wait.from} -> ${wait.to}) remains open with ${dependents.length} incoming dependent waits. In thread:${task.thread}, ${returned.size} authors returned after another author posted, among ${messages.length} posts timestamped since the wait was recorded (inclusive, millisecond precision). The thread currently has ${count} participants; that is potential audience, not delivery or reads. Repeated discussion and audience size alone do not establish waste.`,
				[...returned],
			);
		}
	}
	return notices.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function waitingOrganizations(db: DatabaseSync, roots: Set<string>): Set<string> {
	const recorded = db
		.prepare(`select l.recorded_by, t.organization as task_organization from links l
		left join work_tasks t on l.from_kind = 'task' and t.id = l.from_id
		where l.relation in (${WAITS.map(() => "?").join(",")}) and l.resolved_at is null`)
		.all(...WAITS) as { recorded_by: string; task_organization: string | null }[];
	if (!recorded.length || !roots.size) return new Set();
	const { managerOf } = membership(db, roots.values().next().value!).replay(Number.POSITIVE_INFINITY);
	const recordedRoot = (id: string) => {
		const seen = new Set<string>();
		let at = id;
		for (;;) {
			if (seen.has(at)) return at;
			seen.add(at);
			const manager = managerOf(at);
			if (manager === null) return at;
			at = manager;
		}
	};
	return new Set(
		recorded.flatMap((wait) => [
			recordedRoot(wait.recorded_by),
			...(wait.task_organization ? [recordedRoot(wait.task_organization)] : []),
		]),
	);
}

/** Strongly connected components keep a single cyclic dependency group together. */
export function waitComponents(waits: Pick<Wait, "from" | "to">[]): string[][] {
	const edges = new Map<string, string[]>();
	for (const wait of waits) {
		edges.set(wait.from, [...(edges.get(wait.from) ?? []), wait.to]);
		if (!edges.has(wait.to)) edges.set(wait.to, []);
	}
	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const stack: string[] = [];
	const active = new Set<string>();
	const result: string[][] = [];
	const visit = (node: string) => {
		index.set(node, index.size);
		low.set(node, index.get(node)!);
		stack.push(node);
		active.add(node);
		for (const next of edges.get(node)!) {
			if (!index.has(next)) {
				visit(next);
				low.set(node, Math.min(low.get(node)!, low.get(next)!));
			} else if (active.has(next)) low.set(node, Math.min(low.get(node)!, index.get(next)!));
		}
		if (low.get(node) !== index.get(node)) return;
		const component: string[] = [];
		for (;;) {
			const item = stack.pop()!;
			active.delete(item);
			component.push(item);
			if (item === node) break;
		}
		result.push(component);
	};
	for (const node of edges.keys()) if (!index.has(node)) visit(node);
	return result;
}

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { organizationIn } from "../../organization/src/directory.js";
import { membership, openWaits, subtreeOf, taskOwnership } from "./fitness.js";
import { WAITS } from "./links.js";
import { audienceAt } from "./threads.js";

/**
 * Read-only views of the organization for the inspection tools. Each reports recorded facts and counts with references
 * (`person:`, `task:`, `file:`, `link:`, `thread:`) and draws no conclusion; the caller interprets.
 */

export interface Window {
	cwd: string;
	from?: number;
	to?: number;
	/** Keep only people in this person's subtree. */
	subtree?: string;
}

interface Touch {
	person: string;
	at: number;
	edit: boolean;
	path: string;
}

/** Status as the directory reports it, plus `left` for a former member. */
function statuses(db: DatabaseSync, organization: string): Map<string, string> {
	const words: Record<string, string> = { busy: "working", waiting: "asking the operator", idle: "idle" };
	return new Map(
		organizationIn(db, organization, true).members.map((member) => [
			member.id,
			member.retired ? "left" : (words[member.status] ?? member.status),
		]),
	);
}

/** Every read, edit, and write the runtime indexed for the organization's people, with the path made absolute. */
function touches(db: DatabaseSync, people: Set<string>, window: Window): Touch[] {
	const rows = db
		.prepare(
			`select m.session_id, m.at, m.tool, m.preview, s.cwd from messages m join sessions s on s.id = m.session_id
			where m.part <> '' and m.tool in ('read', 'edit', 'write')`,
		)
		.all() as { session_id: string; at: number; tool: string; preview: string; cwd: string }[];
	return rows
		.filter(
			(row) =>
				people.has(row.session_id) &&
				row.at >= (window.from ?? Number.NEGATIVE_INFINITY) &&
				row.at < (window.to ?? Number.POSITIVE_INFINITY),
		)
		.map((row) => ({
			person: row.session_id,
			at: row.at,
			edit: row.tool !== "read",
			path: absolute(row.cwd, row.preview),
		}));
}

function absolute(cwd: string, path: string): string {
	return path.startsWith("~") ? join(homedir(), path.slice(1)) : resolve(cwd, path);
}

/** A path when it names one (it has a separator or starts with `.` or `~`); otherwise a word to find within paths. */
function matcher(area: string, cwd: string): (path: string) => boolean {
	if (area.includes("/") || area.startsWith(".") || area.startsWith("~")) {
		const root = absolute(cwd, area);
		const prefix = root.endsWith(sep) ? root : root + sep;
		return (path) => path === root || path.startsWith(prefix);
	}
	const word = area.toLowerCase();
	return (path) => path.toLowerCase().includes(word);
}

function taskTitleOf(bundle: string): string | null {
	const goal = join(bundle, "task.md");
	return existsSync(goal)
		? (readFileSync(goal, "utf8")
				.match(/^#\s+(.+)$/m)?.[1]
				?.trim() ?? null)
		: null;
}

/** The people the inspection covers: the organization's members, or one person's subtree of them. */
function covered(db: DatabaseSync, organization: string, window: Window) {
	const status = statuses(db, organization);
	const people = new Set(status.keys());
	if (window.subtree) {
		const kept = subtreeOf(db, window.subtree);
		for (const person of people) if (!kept.has(person)) people.delete(person);
	}
	return { status, people };
}

/**
 * Who knows an area (a path, or a word within paths): the people who called read or edit there, with counts, last
 * touch, the tasks they held while touching it (with the outcome of a finished one), their status, and whether a
 * compaction of their session started since their last touch, sorted by how many touches, then by recency. Calls are
 * counted whether or not they succeeded, and a compaction that started may have failed: both are what the runtime records.
 */
export function expertsOn(db: DatabaseSync, organization: string, area: string, window: Window) {
	const { status, people } = covered(db, organization, window);
	const inArea = matcher(area, window.cwd);
	const held = db.prepare(
		`select a.task_id, a.assigned_at, a.ended_at, a.end_reason, a.outcome, t.bundle from assignments a
		join work_tasks t on t.id = a.task_id where a.person = ?`,
	);
	const compacted = db.prepare(
		"select 1 from events where session_id = ? and type = 'run_state' and json_extract(data, '$.to') = 'compacting' and at > ?",
	);
	const found = new Map<string, Touch[]>();
	for (const touch of touches(db, people, window).filter((t) => inArea(t.path)))
		found.set(touch.person, [...(found.get(touch.person) ?? []), touch]);
	return [...found]
		.map(([person, mine]) => {
			const lastTouch = Math.max(...mine.map((t) => t.at));
			const assignments = held.all(person) as {
				task_id: string;
				assigned_at: number;
				ended_at: number | null;
				end_reason: string | null;
				outcome: string | null;
				bundle: string;
			}[];
			const tasks = assignments
				.filter((a) => mine.some((t) => a.assigned_at <= t.at && (a.ended_at === null || t.at < a.ended_at)))
				.map((a) => ({
					ref: `task:${a.task_id}`,
					title: taskTitleOf(a.bundle),
					finished: a.end_reason === "finished",
					outcome: a.outcome,
				}));
			return {
				ref: `person:${person}`,
				status: status.get(person) ?? "unknown",
				reads: mine.filter((t) => !t.edit).length,
				edits: mine.filter((t) => t.edit).length,
				lastTouch,
				compactionSince: Boolean(compacted.get(person, lastTouch)),
				tasks,
			};
		})
		.sort(byActivity);
}

/** What a person knows: the directories it read or edited in, with counts and last touch, most touched first. */
export function areasOf(db: DatabaseSync, organization: string, person: string, window: Window) {
	const { people } = covered(db, organization, window);
	const areas = new Map<string, { ref: string; reads: number; edits: number; lastTouch: number }>();
	for (const touch of touches(db, people, window).filter((t) => t.person === person)) {
		const directory = dirname(touch.path);
		const area = areas.get(directory) ?? { ref: `file:${directory}`, reads: 0, edits: 0, lastTouch: 0 };
		if (touch.edit) area.edits++;
		else area.reads++;
		area.lastTouch = Math.max(area.lastTouch, touch.at);
		areas.set(directory, area);
	}
	return [...areas.values()].sort(byActivity);
}

function byActivity(
	a: { reads: number; edits: number; lastTouch: number },
	b: { reads: number; edits: number; lastTouch: number },
) {
	return b.reads + b.edits - (a.reads + a.edits) || b.lastTouch - a.lastTouch;
}

/** Narrow a view to one person's subtree, one person, or one task; the whole organization when empty. */
export type Scope = { subtree?: string; person?: string; task?: string };

interface OpenWait {
	id: string;
	from_kind: string;
	from_id: string;
	to_kind: string;
	to_id: string;
	relation: string;
	reason: string | null;
	recorded_by: string;
	created_at: number;
	resolved_at?: number | null;
}

/**
 * What blocks what: the organization's open waits at the window's end, grouped by what they wait on (most waits first,
 * then the oldest), each with its waiter, reason, age, and whether it crosses teams; with a window start, also the
 * waits resolved inside the window, with how long they waited. Everything is judged as of the moment that matters:
 * the window's end for an open wait, the resolution for a resolved one. The waiter is whoever held the waiting task
 * then (or the waiting person; the recorder when neither is known). Two people are on one team when one manages the
 * other or they share a manager; a wait crosses teams when no waiter shares a team with anyone it waits on.
 */
export function waitsIn(db: DatabaseSync, organization: string, window: Window, scope: Scope = {}) {
	const at = window.to ?? Date.now();
	const { owns } = taskOwnership(db, organization);
	const { memberAt, managerAt } = membership(db, organization);
	const heldBy = db.prepare(
		"select person from assignments where task_id = ? and assigned_at <= ? and (ended_at is null or ended_at > ?)",
	);
	// Only members count as holders: an old link may still point at another organization's task.
	const holdersAt = (task: string, when: number) =>
		(heldBy.all(task, when, when) as { person: string }[])
			.map((row) => row.person)
			.filter((person) => memberAt(person, when));
	const sameTeam = (a: string, b: string, when: number) => {
		const ma = managerAt(a, when);
		const mb = managerAt(b, when);
		return a === b || ma === b || mb === a || (ma !== null && ma === mb);
	};
	const parties = (kind: string, id: string, when: number) =>
		kind === "person" ? [id] : kind === "task" ? holdersAt(id, when) : [];
	const inScope = scoped(scope, holdersAt, managerAt);
	const describe = (link: OpenWait, when: number) => {
		const waiters = parties(link.from_kind, link.from_id, when);
		const owners = parties(link.to_kind, link.to_id, when);
		const from = waiters.length ? waiters : [link.recorded_by];
		return {
			ref: `link:${link.id}`,
			from: `${link.from_kind}:${link.from_id}`,
			to: `${link.to_kind}:${link.to_id}`,
			relation: link.relation,
			reason: link.reason,
			recordedBy: `person:${link.recorded_by}`,
			waiters: from.map((person) => `person:${person}`),
			ageHours: (when - link.created_at) / 3_600_000,
			crossesTeams: owners.length > 0 && from.every((w) => owners.every((o) => !sameTeam(w, o, when))),
		};
	};
	const open = (openWaits(db, organization, at) as OpenWait[])
		.filter((link) => inScope(link, at))
		.map((link) => describe(link, at));
	const targets = new Map<string, ReturnType<typeof describe>[]>();
	for (const wait of open) targets.set(wait.to, [...(targets.get(wait.to) ?? []), wait]);
	const unblocked =
		window.from === undefined
			? []
			: (
					db
						.prepare(
							`select * from links where relation in (${WAITS.map(() => "?").join(", ")}) and resolved_at >= ? and resolved_at < ?
							order by resolved_at, id`,
						)
						.all(...WAITS, window.from, at) as unknown as (OpenWait & { resolved_at: number })[]
				)
					.filter(
						(link) =>
							(link.from_kind === "task" && owns(link.from_id, link.resolved_at)) ||
							memberAt(link.recorded_by, link.resolved_at),
					)
					.filter((link) => inScope(link, link.resolved_at))
					.map((link) => ({ ...describe(link, link.resolved_at), resolvedAt: link.resolved_at }));
	const oldest = (waits: { ageHours: number }[]) => Math.max(...waits.map((w) => w.ageHours));
	return {
		open: open.length,
		targets: [...targets]
			.map(([ref, waits]) => ({ ref, waits }))
			.sort((a, b) => b.waits.length - a.waits.length || oldest(b.waits) - oldest(a.waits)),
		unblocked,
	};
}

/** Open task states at the cutoff, plus arrivals and closes inside the requested window. */
export function workIn(db: DatabaseSync, organization: string, window: Window, scope: Scope = {}) {
	const at = window.to ?? Date.now();
	const { owns } = taskOwnership(db, organization);
	const { managerAt } = membership(db, organization);
	const assignments = db.prepare(
		"select person from assignments where task_id = ? and assigned_at <= ? and (ended_at is null or ended_at > ? or (? and ended_at = ?)) order by person",
	);
	const holders = (id: string, when: number, closing = false) => [
		...new Set(
			(assignments.all(id, when, when, Number(closing), when) as { person: string }[]).map((row) => row.person),
		),
	];
	const within = (id: string, when: number, closing = false) => {
		if (scope.task) return id === scope.task;
		if (!scope.person && !scope.subtree) return true;
		return holders(id, when, closing).some((person) => {
			if (scope.person) return person === scope.person;
			const seen = new Set<string>();
			for (let current: string | null = person; current && !seen.has(current); current = managerAt(current, when)) {
				if (current === scope.subtree) return true;
				seen.add(current);
			}
			return false;
		});
	};
	const tasks = db
		.prepare(
			"select id, opened_at, archived_at, close_status from work_tasks where opened_at is not null order by opened_at, id",
		)
		.all() as { id: string; opened_at: number; archived_at: number | null; close_status: string | null }[];
	const waits = openWaits(db, organization, at);
	const open = tasks
		.filter(
			(task) =>
				task.opened_at < at &&
				(task.archived_at === null || task.archived_at > at) &&
				owns(task.id, at) &&
				within(task.id, at),
		)
		.map((task) => ({
			ref: `task:${task.id}`,
			ageHours: (at - task.opened_at) / 3_600_000,
			holders: holders(task.id, at).map((person) => `person:${person}`),
			waits: waits
				.filter((wait) => wait.from_kind === "task" && wait.from_id === task.id)
				.map((wait) => `link:${wait.id}`),
		}));
	const load = new Map<string, string[]>();
	for (const task of open) for (const person of task.holders) load.set(person, [...(load.get(person) ?? []), task.ref]);
	return {
		opened:
			window.from === undefined
				? []
				: tasks
						.filter(
							(task) =>
								task.opened_at >= window.from! &&
								task.opened_at < at &&
								owns(task.id, task.opened_at) &&
								within(task.id, task.opened_at),
						)
						.map((task) => ({ ref: `task:${task.id}`, at: task.opened_at })),
		closed:
			window.from === undefined
				? []
				: tasks
						.filter(
							(task) =>
								task.archived_at !== null &&
								task.archived_at >= window.from! &&
								task.archived_at < at &&
								owns(task.id, task.archived_at) &&
								within(task.id, task.archived_at, true),
						)
						.map((task) => ({ ref: `task:${task.id}`, at: task.archived_at!, status: task.close_status })),
		ready: open.filter((task) => !task.waits.length && !task.holders.length),
		waiting: open.filter((task) => task.waits.length > 0),
		inProgress: open.filter((task) => !task.waits.length && task.holders.length > 0),
		multiple: [...load].filter(([, tasks]) => tasks.length > 1).map(([person, tasks]) => ({ person, tasks })),
	};
}

export function communicationIn(db: DatabaseSync, organization: string, window: Window, scope: Scope = {}) {
	const at = window.to ?? Date.now();
	const { memberAt, managerAt } = membership(db, organization);
	const within = (person: string, when: number) => {
		if (!memberAt(person, when)) return false;
		if (scope.person) return person === scope.person;
		if (!scope.subtree) return true;
		const seen = new Set<string>();
		for (let current: string | null = person; current && !seen.has(current); current = managerAt(current, when)) {
			if (current === scope.subtree) return true;
			seen.add(current);
		}
		return false;
	};
	const messages = db
		.prepare(
			"select m.thread_id, m.sender, m.at from thread_messages m join threads t on t.id = m.thread_id where m.at >= ? and m.at < ? order by m.seq",
		)
		.all(window.from ?? 0, at) as { thread_id: string; sender: string; at: number }[];
	const pairs = new Map<string, { people: string[]; messages: number }>();
	const teams = new Map<string, { managers: string[]; messages: number }>();
	const threads = new Map<string, number>();
	for (const message of messages) {
		if (!memberAt(message.sender, message.at)) continue;
		const others = audienceAt(db, message.thread_id, message.at).filter(
			(person) => person !== message.sender && memberAt(person, message.at),
		);
		let included = within(message.sender, message.at);
		for (const other of others) {
			if (!within(message.sender, message.at) && !within(other, message.at)) continue;
			included = true;
			const people = [message.sender, other].sort().map((person) => `person:${person}`);
			const key = JSON.stringify(people);
			const pair = pairs.get(key) ?? { people, messages: 0 };
			pair.messages++;
			pairs.set(key, pair);
			const managers = [managerAt(message.sender, message.at) ?? message.sender, managerAt(other, message.at) ?? other]
				.sort()
				.map((person) => `person:${person}`);
			const teamKey = JSON.stringify(managers);
			const team = teams.get(teamKey) ?? { managers, messages: 0 };
			team.messages++;
			teams.set(teamKey, team);
		}
		if (included) threads.set(message.thread_id, (threads.get(message.thread_id) ?? 0) + 1);
	}
	const requests = new Map<string, { person: string; decisions: string[]; escalations: string[] }>();
	const request = (person: string) => {
		const entry = requests.get(person) ?? { person: `person:${person}`, decisions: [], escalations: [] };
		requests.set(person, entry);
		return entry;
	};
	const decisions = db
		.prepare(
			"select id, to_id from links where relation = 'requires_decision' and to_kind = 'person' and created_at < ? and (resolved_at is null or resolved_at > ?) order by id",
		)
		.all(at, at) as { id: string; to_id: string }[];
	for (const wait of decisions) if (within(wait.to_id, at)) request(wait.to_id).decisions.push(`link:${wait.id}`);
	const escalations = db
		.prepare(
			"select id, created_by from threads where kind = 'escalation' and created_at < ? and (closed_at is null or closed_at > ?) order by id",
		)
		.all(at, at) as { id: string; created_by: string }[];
	const latest = db.prepare(
		"select sender from thread_messages where thread_id = ? and at < ? order by seq desc limit 1",
	);
	for (const thread of escalations) {
		const last = latest.get(thread.id, at) as { sender: string } | undefined;
		if (!last) continue;
		for (const person of audienceAt(db, thread.id, at))
			if (person !== thread.created_by && person !== last.sender && within(person, at))
				request(person).escalations.push(`thread:${thread.id}`);
	}
	return {
		audienceHistory: {
			completeSince: (
				db.prepare("select min(at) as at from events where type = 'thread_participation_tracking'").get() as {
					at: number | null;
				}
			).at,
			earlierHistory: "incomplete: departed participants before tracking cannot be recovered",
		},
		requests: [...requests.values()].sort((a, b) => a.person.localeCompare(b.person)),
		pairs: [...pairs.values()].sort(
			(a, b) => b.messages - a.messages || JSON.stringify(a.people).localeCompare(JSON.stringify(b.people)),
		),
		teams: [...teams.values()].sort(
			(a, b) => b.messages - a.messages || JSON.stringify(a.managers).localeCompare(JSON.stringify(b.managers)),
		),
		threads: [...threads]
			.map(([id, messages]) => ({ ref: `thread:${id}`, messages }))
			.sort((a, b) => b.messages - a.messages || a.ref.localeCompare(b.ref)),
	};
}

/** Scope a wait by its recorder, endpoint people, or task holders at the judged moment. */
function scoped(
	scope: Scope,
	holdersAt: (task: string, when: number) => string[],
	managerAt: (person: string, when: number) => string | null,
) {
	if (scope.task)
		return (link: OpenWait) =>
			(link.from_kind === "task" && link.from_id === scope.task) ||
			(link.to_kind === "task" && link.to_id === scope.task);
	const root = scope.person ?? scope.subtree;
	if (!root) return () => true;
	const within = (person: string, when: number) => {
		if (scope.person) return person === root;
		const seen = new Set<string>();
		for (let link: string | null = person; link && !seen.has(link); link = managerAt(link, when)) {
			if (link === root) return true;
			seen.add(link);
		}
		return false;
	};
	return (link: OpenWait, when: number) => {
		const touches = (kind: string, id: string) =>
			(kind === "person" && within(id, when)) ||
			(kind === "task" && holdersAt(id, when).some((holder) => within(holder, when)));
		return within(link.recorded_by, when) || touches(link.from_kind, link.from_id) || touches(link.to_kind, link.to_id);
	};
}

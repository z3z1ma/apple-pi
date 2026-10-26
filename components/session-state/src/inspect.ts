import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { organizationIn } from "../../organization/src/directory.js";
import { subtreeOf } from "./fitness.js";

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
		return (path) => path === root || path.startsWith(root + sep);
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

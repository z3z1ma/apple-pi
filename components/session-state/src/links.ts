import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { rootOf, taskOrganization } from "./tree.js";

/** The kinds of things a link can join; an id is a task id, a session id, a thread or message id, a SHA, a URL, or a path. */
export const ENTITY_KINDS = [
	"task",
	"person",
	"thread",
	"message",
	"commit",
	"pr",
	"file",
	"check",
	"organization",
] as const;
export interface Entity {
	kind: string;
	id: string;
}
export interface LinkRecord {
	from: Entity;
	to: Entity;
	relation: string;
	reason?: string;
	data?: unknown;
	inferred?: boolean;
	confidence?: number;
}
export interface Link {
	id: string;
	organization: string | null;
	from_kind: string;
	from_id: string;
	to_kind: string;
	to_id: string;
	relation: string;
	reason: string | null;
	data: string | null;
	recorded_by: string;
	inferred: number;
	confidence: number | null;
	created_at: number;
	resolved_at: number | null;
	resolution: string | null;
}

/** Things the runtime records must exist; commits, PRs, files, and check runs live outside it and are taken as named. */
const KNOWN: Record<string, string> = {
	task: "select 1 from work_tasks where id = ?",
	person: "select 1 from sessions where id = ? and kind = 'root'",
	thread: "select 1 from threads where id = ?",
	message: "select 1 from thread_messages where id = ?",
	organization: "select 1 from sessions where id = ? and kind = 'root' and reports_to is null",
};

/** Waits keep work open until their target task is done. */
export const WAITS = ["blocks", "requires_decision"];

/** The defined vocabulary, one relation and its meaning per line, read fresh so a new line needs no other code. */
export function relations(): Record<string, string> {
	return JSON.parse(readFileSync(new URL("./relations.json", import.meta.url), "utf8"));
}

export function recordLink(db: DatabaseSync, id: string, sender: string, link: LinkRecord, now: number): void {
	if (db.prepare("select 1 from links where id = ?").get(id)) return;
	if (link.inferred && link.confidence === undefined)
		throw new Error("An inferred link needs a confidence from 0 to 1");
	const known = relations();
	if (!Object.hasOwn(known, link.relation))
		throw new Error(`Unknown relation "${link.relation}"; use one of: ${Object.keys(known).join(", ")}`);
	for (const entity of [link.from, link.to]) {
		if (!(ENTITY_KINDS as readonly string[]).includes(entity.kind))
			throw new Error(`Unknown kind "${entity.kind}"; use one of: ${ENTITY_KINDS.join(", ")}`);
		const known = KNOWN[entity.kind];
		if (known && !db.prepare(known).get(entity.id)) throw new Error(`No ${entity.kind} ${entity.id}`);
	}
	// Links stay inside the recorder's organization: another organization's tasks and people are not ours to join.
	const root = rootOf(db, sender);
	for (const entity of [link.from, link.to]) {
		const owner =
			entity.kind === "task"
				? taskOrganization(db, entity.id)
				: entity.kind === "person"
					? rootOf(db, entity.id)
					: entity.kind === "organization"
						? entity.id
						: root;
		if (owner !== root) throw new Error(`${entity.kind}:${entity.id} belongs to another organization`);
	}
	if (
		WAITS.includes(link.relation) &&
		link.to.kind === "task" &&
		db.prepare("select 1 from work_tasks where id = ? and close_status = 'done'").get(link.to.id)
	)
		throw new Error(`Task ${link.to.id} is already done; nothing waits on it`);
	db.prepare(
		`insert into links (id, from_kind, from_id, to_kind, to_id, relation, reason, data, recorded_by, inferred, confidence, created_at, organization)
		values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		id,
		link.from.kind,
		link.from.id,
		link.to.kind,
		link.to.id,
		link.relation,
		link.reason ?? null,
		link.data === undefined ? null : JSON.stringify(link.data),
		sender,
		link.inferred ? 1 : 0,
		link.inferred ? (link.confidence ?? null) : null,
		now,
		root,
	);
}

/** A link resolves once; `replay` accepts the same resolution again after a restart. */
export function resolveLink(
	db: DatabaseSync,
	sender: string,
	id: string,
	resolution: string | undefined,
	now: number,
	replay = false,
): void {
	const link = db.prepare("select * from links where id = ?").get(id) as unknown as Link | undefined;
	if (!link) throw new Error(`No link ${id}`);
	const organization = organizationOf(db, link);
	if (!organization) throw new Error(`Link ${id} has no recoverable organization`);
	if (rootOf(db, sender) !== organization) throw new Error(`Link ${id} belongs to another organization`);
	if (link.resolved_at !== null) {
		if (replay && link.resolution === (resolution ?? null)) return;
		throw new Error(`Link ${id} is already resolved`);
	}
	db.prepare("update links set resolved_at = ?, resolution = ? where id = ?").run(now, resolution ?? null, id);
}

/**
 * New links retain their originating organization independently of recorder lifetime. Legacy links use surviving
 * endpoints or the recorder; missing evidence remains unknown rather than assigning ownership to the resolver.
 */
function organizationOf(db: DatabaseSync, link: Link): string | undefined {
	if (link.organization) return rootOf(db, link.organization);
	for (const [kind, id] of [
		[link.from_kind, link.from_id],
		[link.to_kind, link.to_id],
	]) {
		if (kind === "task") {
			const organization = taskOrganization(db, id);
			if (organization) return organization;
		}
		if (kind === "person" && db.prepare("select 1 from sessions where id = ?").get(id)) return rootOf(db, id);
		if (kind === "organization") return rootOf(db, id);
	}
	return db.prepare("select 1 from sessions where id = ?").get(link.recorded_by)
		? rootOf(db, link.recorded_by)
		: undefined;
}

/** A task closed done ends every wait on it; a cancelled one ends none. */
export function resolveWaitsOn(db: DatabaseSync, taskId: string, now: number): void {
	db.prepare(
		`update links set resolved_at = ?, resolution = 'done'
		where to_kind = 'task' and to_id = ? and relation in (${WAITS.map(() => "?").join(", ")}) and resolved_at is null`,
	).run(now, taskId, ...WAITS);
}

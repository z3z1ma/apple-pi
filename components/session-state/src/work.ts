import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promoteLedgerTask, retrospectiveTemplate, writeAtomicTextFile } from "../../shared/src/ledger-files.js";
import { resolveWaitsOn } from "./links.js";
import { statePaths } from "./paths.js";
import { nameOf, OPERATOR, type ThreadPost } from "./threads.js";
import { type Worth, worthLines } from "./valuation.js";

export type WorkAction =
	| ({ action: "take"; goal?: string; title?: string; task?: string } & Worth)
	| ({ action: "assign"; person: string; goal?: string; title?: string; task?: string } & Worth)
	| { action: "focus"; task: string }
	| { action: "unassign"; person: string; task: string }
	| { action: "finish"; outcome: string }
	| { action: "promote"; task: string; title?: string; description?: string };
export type WorkCommand = {
	kind: "work";
	cwd: string;
	/** The operator has no incarnation; its UI supplies the attached terminal to wake beside. */
	tmux?: { socket: string; pane: string };
} & WorkAction;

export interface WorkTask {
	id: string;
	bundle: string;
	project: string;
	organization: string;
	ephemeral: number;
	thread: string;
	/** When it closed: an ephemeral task's archive, or a ledger task's move to history. */
	archived_at: number | null;
	/** When it became the organization's obligation; null for a task recorded before this column existed. */
	opened_at: number | null;
	close_status: "done" | "cancelled" | null;
}

export interface Assignment {
	id: number;
	person: string;
	task_id: string;
	assigned_by: string;
	assigned_at: number;
	ended_at: number | null;
	outcome: string | null;
	end_reason: string | null;
}

export interface WorkChange {
	task: WorkTask;
	person: string;
	post: ThreadPost;
	/** The changed person hears its own change, too, even when it wrote the thread message. */
	notify: string;
	goal: boolean;
}

export function withWork<T>(read: (db: DatabaseSync) => T): T | undefined {
	const path = statePaths().db;
	if (!existsSync(path)) return undefined;
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		if (!db.prepare("select 1 from sqlite_master where name = 'work_tasks' and type = 'table'").get()) return undefined;
		return read(db);
	} finally {
		db.close();
	}
}

export function focusedTask(db: DatabaseSync, person: string): WorkTask | undefined {
	return db
		.prepare("select t.* from work_tasks t join work_focus f on f.task_id = t.id where f.person = ?")
		.get(person) as unknown as WorkTask | undefined;
}

export function taskTitle(task: WorkTask): string {
	return (
		readFileSync(join(task.bundle, "task.md"), "utf8")
			.match(/^#\s+(.+)$/m)?.[1]
			?.trim() || basename(task.bundle)
	);
}

/** The goal is a file, not a cached database field. A missing goal is an error, not an empty assignment. */
export function goalText(person: string): string | undefined {
	return withWork((db) => {
		const task = focusedTask(db, person);
		if (!task) return undefined;
		return `Focused task: ${task.id}\nGoal file: ${join(task.bundle, "task.md")}\nTask thread: ${task.thread}\n\n${readFileSync(join(task.bundle, "task.md"), "utf8")}`;
	});
}

function member(db: DatabaseSync, person: string) {
	const row = db
		.prepare("select id, reports_to, manages, retired_at from sessions where id = ? and kind = 'root'")
		.get(person) as
		| { id: string; reports_to: string | null; manages: number | null; retired_at: number | null }
		| undefined;
	if (!row) throw new Error(`Unknown person ${person}`);
	return row;
}

function rootOf(db: DatabaseSync, person: string): string {
	const seen = new Set<string>();
	let root = person;
	while (!seen.has(root)) {
		seen.add(root);
		const row = db.prepare("select reports_to from sessions where id = ?").get(root) as
			| { reports_to: string | null }
			| undefined;
		if (!row?.reports_to || !db.prepare("select 1 from sessions where id = ?").get(row.reports_to)) return root;
		root = row.reports_to;
	}
	throw new Error("The organization has a cycle");
}

function mayManage(db: DatabaseSync, actor: string, person: string): void {
	if (actor === OPERATOR) return;
	const manager = member(db, actor);
	const helper = db.prepare("select 1 from program_peers where session_id = ? and created_by = ?").get(person, actor);
	if (manager.reports_to && !manager.manages && !helper)
		throw new Error("Only a manager can assign or unassign someone else's work");
	if (rootOf(db, actor) !== rootOf(db, person)) throw new Error("The person is in another organization");
}

function bundlePath(cwd: string, input: string): string {
	const path = resolve(cwd, input);
	const candidate = basename(path) === "task.md" ? dirname(path) : path;
	if (existsSync(join(candidate, "task.md"))) return realpathSync(candidate);
	const ledger = join(cwd, ".ledger", input);
	if (existsSync(join(ledger, "task.md"))) return realpathSync(ledger);
	throw new Error(`No task.md at ${candidate}`);
}

function findTask(db: DatabaseSync, cwd: string, input: string): WorkTask | undefined {
	const byId = db.prepare("select * from work_tasks where id = ?").get(input) as unknown as WorkTask | undefined;
	if (byId) return byId;
	return db.prepare("select * from work_tasks where bundle = ?").get(bundlePath(cwd, input)) as unknown as
		| WorkTask
		| undefined;
}

/** The runtime's id for a task named by its id, its bundle, its task.md, or its ledger id. */
export function taskIdOf(db: DatabaseSync, cwd: string, input: string): string {
	const task = findTask(db, cwd, input);
	if (!task) throw new Error(`No task ${input}`);
	return task.id;
}

function requireTask(db: DatabaseSync, cwd: string, input: string): WorkTask {
	const task = findTask(db, cwd, input);
	if (!task) throw new Error("This task is not assigned yet; take_task or assign it first");
	return task;
}

function assignment(db: DatabaseSync, person: string, task: WorkTask): Assignment {
	const row = db
		.prepare("select * from assignments where person = ? and task_id = ? and ended_at is null")
		.get(person, task.id) as unknown as Assignment | undefined;
	if (!row) throw new Error(`${person} does not hold ${task.id}`);
	return row;
}

function createTask(
	db: DatabaseSync,
	stateDir: string,
	id: string,
	actor: string,
	person: string,
	command: Extract<WorkCommand, { action: "take" | "assign" }>,
	now: number,
	rollback: (() => void)[],
): WorkTask {
	if (Boolean(command.goal?.trim()) === Boolean(command.task?.trim()))
		throw new Error("Give exactly one of goal or task");
	const organization = rootOf(db, person);
	if (command.task) {
		const found = findTask(db, command.cwd, command.task);
		if (found) {
			if (found.organization !== organization) throw new Error("The task belongs to another organization");
			if (found.archived_at) throw new Error("The task is finished");
			if (
				command.action === "take" &&
				db
					.prepare("select 1 from assignments where task_id = ? and person != ? and ended_at is null")
					.get(found.id, person)
			)
				throw new Error("This task already has an assignee; ask its manager to assign you alongside them");
			return found;
		}
	}
	const project = realpathSync(command.cwd);
	const ephemeral = command.goal ? 1 : 0;
	const bundle = command.task ? bundlePath(project, command.task) : join(stateDir, "tasks", id);
	if (!ephemeral && basename(dirname(bundle)) !== ".ledger")
		throw new Error("Use a live ledger bundle, or an existing ephemeral task id");
	if (ephemeral && !existsSync(bundle)) {
		mkdirSync(bundle, { recursive: true, mode: 0o700 });
		rollback.push(() => rmSync(bundle, { recursive: true, force: true }));
		const goal = command.goal!.trim();
		const title = command.title?.trim() || goal.split("\n")[0].replace(/^#+\s*/, "");
		const date = new Date(now).toISOString().slice(0, 10);
		writeFileSync(
			join(bundle, "task.md"),
			`Status: in-progress\nCreated: ${date}\n${worthLines(command, nameOf(db, actor))}\n# ${title}\n\n## Intent\n\n${goal}\n\n## Outcome\n\nPending completion.\n`,
		);
		writeFileSync(join(bundle, "retrospective.md"), retrospectiveTemplate(date));
	}
	return recordTask(
		db,
		id,
		bundle,
		ephemeral ? project : dirname(dirname(bundle)),
		organization,
		ephemeral,
		actor,
		now,
	);
}

/** The task becomes the organization's obligation now, with its own thread. */
function recordTask(
	db: DatabaseSync,
	id: string,
	bundle: string,
	project: string,
	organization: string,
	ephemeral: number,
	actor: string,
	now: number,
): WorkTask {
	const task: WorkTask = {
		id,
		bundle,
		project,
		organization,
		ephemeral,
		thread: `task:${id}`,
		archived_at: null,
		opened_at: now,
		close_status: null,
	};
	db.prepare(
		"insert into work_tasks (id, bundle, project, organization, ephemeral, thread, opened_at) values (?, ?, ?, ?, ?, ?, ?)",
	).run(task.id, task.bundle, task.project, task.organization, task.ephemeral, task.thread, now);
	db.prepare("insert into threads (id, kind, subject, created_by, created_at) values (?, 'task', ?, ?, ?)").run(
		task.thread,
		taskTitle(task),
		actor,
		now,
	);
	return task;
}

function participate(db: DatabaseSync, task: WorkTask, person: string, now: number): void {
	db.prepare(
		"insert into thread_participants (thread_id, participant, delivery, read_up_to, joined_at) values (?, ?, 'push', 0, ?) on conflict do nothing",
	).run(task.thread, person, now);
}

function setFocus(db: DatabaseSync, person: string, task: WorkTask): void {
	db.prepare(
		"insert into work_focus (person, task_id) values (?, ?) on conflict(person) do update set task_id = excluded.task_id",
	).run(person, task.id);
}

function writeOutcome(
	task: WorkTask,
	held: Assignment,
	person: string,
	outcome: string,
	done: boolean,
	rollback: (() => void)[],
): void {
	const path = join(task.bundle, "task.md");
	const before = readFileSync(path, "utf8");
	const heading = `### Assignment ${held.id}: ${person}`;
	let after = `${before.trimEnd()}\n\n${heading}\n\n${outcome}\n`;
	if (done) after = after.replace(/^Status:.*$/m, "Status: done");
	rollback.push(() => writeAtomicTextFile(path, before));
	writeAtomicTextFile(path, after);
}

/** Apply inside the runtime's transaction; rollback/committed hold the filesystem half of that transaction. */
export function changeWork(
	db: DatabaseSync,
	stateDir: string,
	commandId: string,
	actor: string,
	command: WorkCommand,
	now: number,
	rollback: (() => void)[],
	committed: (() => void)[],
): WorkChange {
	const person = "person" in command && command.person ? command.person : actor;
	if (command.action === "assign" || command.action === "unassign") mayManage(db, actor, person);
	if (person !== OPERATOR && member(db, person).retired_at)
		throw new Error("Rehire this former member before assigning work");
	let task: WorkTask;
	let body: string;
	let goal = false;
	let previousBundle: string | null = null;
	if (command.action === "take" || command.action === "assign") {
		task = createTask(db, stateDir, `work-${commandId}`, actor, person, command, now, rollback);
		if (
			!db
				.prepare("select 1 from assignments where person = ? and task_id = ? and ended_at is null")
				.get(person, task.id)
		) {
			db.prepare("insert into assignments (person, task_id, assigned_by, assigned_at) values (?, ?, ?, ?)").run(
				person,
				task.id,
				actor,
				now,
			);
		}
		setFocus(db, person, task);
		participate(db, task, actor, now);
		participate(db, task, person, now);
		if (command.action === "take") {
			const manager = member(db, person).reports_to;
			if (manager) participate(db, task, manager, now);
		}
		goal = true;
		body = `${nameOf(db, actor)} assigned ${nameOf(db, person)}: ${taskTitle(task)}. Goal: ${join(task.bundle, "task.md")}`;
	} else if (command.action === "finish") {
		if (!command.outcome.trim()) throw new Error("Give an outcome");
		task = focusedTask(db, person)!;
		if (!task) throw new Error("No focused task to finish");
		const held = assignment(db, person, task);
		db.prepare("update assignments set ended_at = ?, outcome = ?, end_reason = 'finished' where id = ?").run(
			now,
			command.outcome,
			held.id,
		);
		db.prepare("delete from work_focus where person = ?").run(person);
		const done = !db.prepare("select 1 from assignments where task_id = ? and ended_at is null").get(task.id);
		writeOutcome(task, held, nameOf(db, person), command.outcome, Boolean(done && task.ephemeral), rollback);
		if (done && task.ephemeral) {
			const previous = task.bundle;
			previousBundle = previous;
			const archived = join(stateDir, "tasks", "history", task.id);
			mkdirSync(dirname(archived), { recursive: true });
			rollback.push(() => rmSync(archived, { recursive: true, force: true }));
			cpSync(previous, archived, { recursive: true });
			task = { ...task, bundle: archived, archived_at: now, close_status: "done" };
			db.prepare("update work_tasks set bundle = ?, archived_at = ?, close_status = 'done' where id = ?").run(
				archived,
				now,
				task.id,
			);
			resolveWaitsOn(db, task.id, now);
			committed.push(() => rmSync(previous, { recursive: true, force: true }));
		}
		body = `${nameOf(db, person)} finished ${taskTitle(task)}.\n\n${command.outcome}`;
	} else {
		task = requireTask(db, command.cwd, command.task);
		if (actor !== OPERATOR && task.organization !== rootOf(db, actor))
			throw new Error("The task belongs to another organization");
		if (command.action === "focus") {
			assignment(db, person, task);
			setFocus(db, person, task);
			goal = true;
			body = `${nameOf(db, person)} focused ${taskTitle(task)}.`;
		} else if (command.action === "unassign") {
			const held = assignment(db, person, task);
			db.prepare("update assignments set ended_at = ?, end_reason = 'unassigned' where id = ?").run(now, held.id);
			db.prepare("delete from work_focus where person = ? and task_id = ?").run(person, task.id);
			participate(db, task, actor, now);
			body = `${nameOf(db, actor)} unassigned ${nameOf(db, person)} from ${taskTitle(task)}.`;
		} else {
			if (!task.ephemeral || task.archived_at) throw new Error("Promote a live ephemeral task");
			const previous = task.bundle;
			previousBundle = previous;
			const title = command.title ?? taskTitle(task);
			const added = promoteLedgerTask(
				task.project,
				previous,
				title,
				command.description ?? title,
				rollback,
				committed,
				actor,
			);
			task = { ...task, bundle: join(task.project, added.bundlePath), ephemeral: 0 };
			db.prepare("update work_tasks set bundle = ?, ephemeral = 0 where id = ?").run(task.bundle, task.id);
			participate(db, task, actor, now);
			goal = focusedTask(db, person)?.id === task.id;
			body = `${nameOf(db, actor)} promoted the task to ${join(task.bundle, "task.md")}.`;
		}
	}
	db.prepare(
		"insert into work_changes (command_id, task_id, person, action, previous_bundle) values (?, ?, ?, ?, ?)",
	).run(commandId, task.id, person, command.action, previousBundle);
	return { task, person, post: { thread: task.thread, body }, notify: person, goal };
}

/** A new ledger task is its creator's organization's obligation from now, assigned or not. */
export function openLedgerTask(db: DatabaseSync, sender: string, bundle: string, now: number): WorkTask {
	const path = realpathSync(bundle);
	const known = db.prepare("select * from work_tasks where bundle = ?").get(path) as unknown as WorkTask | undefined;
	if (known) return known;
	return recordTask(db, `work-${randomUUID()}`, path, dirname(dirname(path)), rootOf(db, sender), 0, sender, now);
}

/**
 * Follow a ledger archive without taking, finishing, or focusing work on anyone's behalf, and record the close once.
 * A task the runtime never heard of opens and closes now, for the sender's organization.
 */
export function closeLedgerTask(
	db: DatabaseSync,
	sender: string,
	from: string,
	to: string,
	status: "done" | "cancelled",
	now: number,
): string[] {
	const source = join(realpathSync(dirname(from)), basename(from));
	const destination = realpathSync(to);
	readFileSync(join(destination, "task.md"), "utf8");
	const known = db.prepare("select id from work_tasks where bundle in (?, ?)").get(source, destination) as
		| { id: string }
		| undefined;
	const id =
		known?.id ??
		recordTask(db, `work-${randomUUID()}`, destination, dirname(dirname(source)), rootOf(db, sender), 0, sender, now)
			.id;
	db.prepare(
		"update work_tasks set bundle = ?, archived_at = coalesce(archived_at, ?), close_status = coalesce(close_status, ?) where id = ?",
	).run(destination, now, status, id);
	if (status === "done") resolveWaitsOn(db, id, now);
	return (db.prepare("select distinct person from assignments where task_id = ?").all(id) as { person: string }[]).map(
		(row) => row.person,
	);
}

/** A committed move may have lost power before removing its source. The destination and assignments already agree. */
export function cleanMovedBundles(db: DatabaseSync): void {
	const moves = db
		.prepare("select command_id, previous_bundle from work_changes where previous_bundle is not null")
		.all() as { command_id: string; previous_bundle: string }[];
	for (const move of moves) {
		try {
			rmSync(move.previous_bundle, { recursive: true, force: true });
			db.prepare("update work_changes set previous_bundle = null where command_id = ?").run(move.command_id);
		} catch (error) {
			console.error(`Task source cleanup failed: ${error}`);
		}
	}
}

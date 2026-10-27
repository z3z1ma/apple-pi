import { chmodSync, closeSync, createReadStream, fsyncSync, mkdirSync, openSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { DatabaseSync } from "node:sqlite";
import { writeAtomicTextFile } from "../../shared/src/ledger-files.js";
import { safeSidecarUsageSessionId, sidecarUsageRelativePath } from "../../shared/src/sidecar-usage-path.js";

export interface Departure {
	commandId: string;
	reason: string;
	name: string | null;
	role: string | null;
	title: string | null;
	reportsTo: string;
	handoffFile: string;
	sessionFile: string | null;
}

/** A permanent identity fact, not a claim that process and filesystem cleanup has finished. */
export function departureOf(db: DatabaseSync, person: string): Departure | undefined {
	const row = db
		.prepare("select data from events where session_id = ? and type = 'person_departed' order by seq desc limit 1")
		.get(person) as { data: string } | undefined;
	return row ? (JSON.parse(row.data) as Departure) : undefined;
}

export function departedPeople(db: DatabaseSync): Map<string, Departure> {
	const rows = db.prepare("select session_id, data from events where type = 'person_departed' order by seq").all() as {
		session_id: string;
		data: string;
	}[];
	return new Map(rows.map((row) => [row.session_id, JSON.parse(row.data) as Departure]));
}

export function saveHandoff(stateDirectory: string, person: string, text: string): string {
	const directory = join(stateDirectory, "handoffs");
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const file = join(directory, `${encodeURIComponent(person)}.md`);
	writeAtomicTextFile(file, text);
	chmodSync(file, 0o600);
	for (const path of [file, directory]) {
		const descriptor = openSync(path, "r");
		try {
			fsyncSync(descriptor);
		} finally {
			closeSync(descriptor);
		}
	}
	return file;
}

export interface DepartureWriter {
	seq: number;
	at: number;
	pid: number;
	startedAt: number;
	sessionFile: string | null;
}

/** Rejected hellos are resource observations, never accepted incarnations or membership. */
export function departureWriters(db: DatabaseSync, person: string): DepartureWriter[] {
	const rows = db
		.prepare(`select seq, at, data from events where session_id = ? and type = 'departure_writer_seen'
		and json_extract(data, '$.cleanedAt') is null order by seq`)
		.all(person) as { seq: number; at: number; data: string }[];
	return rows.map(({ seq, at, data }) => ({ ...JSON.parse(data), seq, at }) as DepartureWriter);
}

/** Only observed writer/binding changes invalidate process proof, not unrelated tool or mail traffic. */
export function departureWatermark(db: DatabaseSync): number {
	return (
		db
			.prepare(`select coalesce(max(seq), 0) as seq from events where type in
		('departure_writer_seen', 'incarnation_started', 'incarnation_ended')`)
			.get() as { seq: number }
	).seq;
}

/** Called only after process proof; the guard revalidates it after reading a header and before every unlink. */
export async function removeDepartureFiles(
	stateDirectory: string,
	person: string,
	departure: Departure,
	checkOwnership: () => void,
): Promise<void> {
	if (departure.sessionFile) {
		const stream = createReadStream(departure.sessionFile, "utf8");
		const lines = createInterface({ input: stream, crlfDelay: Infinity });
		let header: { type?: string; id?: string } | undefined;
		try {
			for await (const line of lines) {
				try {
					header = JSON.parse(line) as typeof header;
				} catch {
					throw new Error(`Cannot verify the transcript header for ${person}`);
				}
				break;
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			return removeUsageFiles(stateDirectory, person, checkOwnership);
		} finally {
			lines.close();
			stream.destroy();
		}
		if (header?.type !== "session" || header.id !== person)
			throw new Error(`Refusing to delete a transcript whose session header does not identify ${person}`);
		checkOwnership();
		unlinkIfPresent(departure.sessionFile);
	}
	removeUsageFiles(stateDirectory, person, checkOwnership);
}

function removeUsageFiles(stateDirectory: string, person: string, checkOwnership: () => void): void {
	if (safeSidecarUsageSessionId(person) !== person)
		throw new Error("Cannot uniquely identify this person's sidecar usage file");
	const file = join(dirname(stateDirectory), sidecarUsageRelativePath(person));
	checkOwnership();
	unlinkIfPresent(file);
	checkOwnership();
	unlinkIfPresent(`${file}.1`);
}

/** The caller owns the cleanup transaction and has already ended current thread participation. */
export function removeDepartureRecords(db: DatabaseSync, person: string, now: number): void {
	for (const [table, column] of [
		["sessions", "id"],
		["incarnations", "session_id"],
		["messages", "session_id"],
		["session_tasks", "session_id"],
		["work_focus", "person"],
		["manager_changes", "session_id"],
	])
		db.prepare(`delete from ${table} where ${column} = ?`).run(person);

	// Retain event chronology and shared facts; only these payloads carry private session context.
	db.prepare(`update events set data = '{}' where session_id = ? and type in (
		'prompt_opened', 'prompt_closed', 'queue_changed', 'config_changed', 'self_changed', 'soul_changed',
		'git_changed', 'last_error_changed', 'parent_session_file_changed', 'previous_session_changed', 'current_task_changed'
	)`).run(person);
	db.prepare("update events set data = json_remove(data, '$.arg') where session_id = ? and type = 'tool_started'").run(
		person,
	);
	db.prepare(`update events set data = json_remove(data, '$.reason') where session_id = ?
		and type like 'command_%' and json_extract(data, '$.commandId') in (
			select command_id from commands where session_id = ? and kind in ('start', 'steer', 'run_turn')
		)`).run(person, person);
	db.prepare(`update events set data = json_remove(data, '$.command.prompt', '$.command.text', '$.command.task')
		where session_id = ? and type = 'command_accepted'
		and json_extract(data, '$.command.kind') in ('start', 'steer', 'run_turn')`).run(person);
	db.prepare(`update commands set command = json_remove(command, '$.prompt', '$.text', '$.task'), reason = null
		where session_id = ? and kind in ('start', 'steer', 'run_turn')`).run(person);
	db.prepare(`update events set data = json_set(data, '$.sessionFile', null)
		where session_id = ? and type = 'person_departed'`).run(person);
	db.prepare(`update events set data = json_set(data, '$.sessionFile', null, '$.cleanedAt', ?)
		where session_id = ? and type = 'departure_writer_seen' and json_extract(data, '$.cleanedAt') is null`).run(
		now,
		person,
	);
}

function unlinkIfPresent(file: string): void {
	try {
		unlinkSync(file);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

// A full-text index of every session's transcript, so recall is one indexed query instead of reading and parsing a
// whole transcript per search. Pi's JSONL stays the source of truth: the index holds each entry's searchable text and
// its address (session, entry id, time); readers drill into the file for the entry itself. The index lives in its own
// database beside the runtime's, written only by the indexer worker (`transcript-indexer.worker.ts`), read by the runtime.
import { open } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";

const SCHEMA = [
	// One row per transcript entry. `words`: what people and agents wrote (operator and agent messages, thinking, mail,
	// summaries). `calls`: tool names and arguments. `results`: tool output.
	`create virtual table entries using fts5(
		words, calls, results,
		session_id unindexed, entry_id unindexed, at unindexed, role unindexed,
		tokenize = 'porter unicode61'
	);
	create table files (
		session_id text primary key,
		file text not null,
		inode integer not null,
		bytes integer not null
	) strict;`,
	// `ordinal`: a message entry's `#N` in search_session's addresses, counting every `message` record from the file's
	// start (load-messages.ts); `files.messages` carries the count across appends. `echo`: 1 for an earlier recall's own
	// result (search_session, revisit_note), which ranks behind original evidence. The index is derived, so this rebuilds.
	`drop table entries;
	create virtual table entries using fts5(
		words, calls, results,
		session_id unindexed, entry_id unindexed, at unindexed, role unindexed, ordinal unindexed, echo unindexed,
		tokenize = 'porter unicode61'
	);
	delete from files;
	alter table files add column messages integer not null default 0;`,
	// `scope`: the session as one token (`scopeToken`), so session and span filters intersect inside FTS. `offset` and
	// `length`: the entry's line in the transcript, for a direct read of a hit's body. Rebuilds the derived index.
	`drop table entries;
	create virtual table entries using fts5(
		words, calls, results, scope,
		session_id unindexed, entry_id unindexed, at unindexed, role unindexed, ordinal unindexed, echo unindexed,
		offset unindexed, length unindexed,
		tokenize = 'porter unicode61'
	);
	delete from files;`,
];

export function openIndex(path: string, readOnly = false): DatabaseSync {
	const db = new DatabaseSync(path, readOnly ? { readOnly: true } : {});
	if (readOnly) return db;
	db.exec("pragma journal_mode = wal; pragma synchronous = normal; pragma busy_timeout = 5000;");
	const { user_version } = db.prepare("pragma user_version").get() as { user_version: number };
	for (let version = user_version; version < SCHEMA.length; version++) {
		db.exec("begin");
		db.exec(SCHEMA[version]!);
		db.exec(`pragma user_version = ${version + 1}`);
		db.exec("commit");
	}
	return db;
}

export interface IndexedEntry {
	entryId: string;
	at: number;
	role: string;
	words: string;
	calls: string;
	results: string;
	/** An earlier recall's result, as search-entries.ts marks `recallEcho`. */
	echo?: boolean;
}

/** Recall tools whose results repeat evidence found elsewhere. */
const RECALL_TOOLS = ["search_session", "revisit_note"];
/** The notebook records search_session shows (load-messages.ts); other `custom` records are extension state. */
const NOTEBOOK_RECORDS = ["notebook.observations.recorded", "notebook.reflections.recorded", "notebook.maintenance"];

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) =>
			part?.type === "text" ? String(part.text ?? "") : part?.type === "thinking" ? String(part.thinking ?? "") : "",
		)
		.filter(Boolean)
		.join("\n");
}

/** An entry's searchable text, or undefined for entries with nothing to find (model changes, labels). */
export function indexedEntry(entry: Record<string, any>): IndexedEntry | undefined {
	if (typeof entry?.id !== "string" || typeof entry.timestamp !== "string") return undefined;
	const at = Date.parse(entry.timestamp);
	const base = { entryId: entry.id, at, words: "", calls: "", results: "" };
	if (entry.type === "message") {
		const message = entry.message ?? {};
		if (message.role === "toolResult") {
			// Nested work (a program's own tool calls) is kept in the result's details.
			const details = message.details === undefined ? "" : `\n${JSON.stringify(message.details)}`;
			return {
				...base,
				role: "tool_result",
				calls: String(message.toolName ?? ""),
				results: textOf(message.content) + details,
				echo: RECALL_TOOLS.includes(message.toolName),
			};
		}
		if (message.role === "assistant") {
			const calls = (Array.isArray(message.content) ? message.content : [])
				.filter((part: any) => part?.type === "toolCall")
				.map((part: any) => `${part.name} ${JSON.stringify(part.arguments ?? {})}`)
				.join("\n");
			return { ...base, role: "assistant", words: textOf(message.content), calls };
		}
		if (message.role === "user") return { ...base, role: "user", words: textOf(message.content) };
		return undefined;
	}
	if (entry.type === "custom_message")
		return { ...base, role: "custom", words: textOf(entry.content), calls: String(entry.customType ?? "") };
	if (entry.type === "compaction" || entry.type === "branch_summary")
		return { ...base, role: entry.type, words: String(entry.summary ?? "") };
	// Extension records the session keeps, such as notebook learnings.
	if (entry.type === "custom" && NOTEBOOK_RECORDS.includes(entry.customType)) {
		const notes = [...(entry.data?.observations ?? []), ...(entry.data?.reflections ?? [])]
			.filter((note: any) => typeof note?.content === "string")
			.map((note: any) => `note:${note.id} ${note.content}`)
			.join("\n\n");
		return notes ? { ...base, role: "notebook", words: notes, calls: String(entry.customType) } : undefined;
	}
	return undefined;
}

/** How much of a transcript one read takes. */
const CHUNK_BYTES = 4 << 20;

/** A session as one FTS token, so a session filter intersects inside the full-text query instead of after it. */
function scopeToken(sessionId: string): string {
	return `s${Buffer.from(sessionId).toString("hex")}`;
}

/**
 * Bring one session's rows up to date with its transcript: append what was written since the last read, or start over
 * when the file was replaced or shrank. Yields between chunks so a long backfill never holds the thread.
 */
export async function indexTranscript(db: DatabaseSync, sessionId: string, file: string): Promise<void> {
	const handle = await open(file, "r");
	try {
		const { size, ino } = await handle.stat();
		const known = db.prepare("select file, inode, bytes, messages from files where session_id = ?").get(sessionId) as
			| { file: string; inode: number; bytes: number; messages: number }
			| undefined;
		let position = known?.bytes ?? 0;
		let messages = known?.messages ?? 0;
		if (known && (known.file !== file || known.inode !== ino || size < known.bytes)) {
			db.prepare("delete from entries where session_id = ?").run(sessionId);
			position = 0;
			messages = 0;
		}
		const insert = db.prepare(
			"insert into entries (words, calls, results, scope, session_id, entry_id, at, role, ordinal, echo, offset, length) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		);
		const scope = scopeToken(sessionId);
		const mark = db.prepare(
			"insert into files (session_id, file, inode, bytes, messages) values (?, ?, ?, ?, ?) on conflict (session_id) do update set file = excluded.file, inode = excluded.inode, bytes = excluded.bytes, messages = excluded.messages",
		);
		let carry: Buffer[] = [];
		while (position < size) {
			const length = Math.min(CHUNK_BYTES, size - position);
			const chunk = Buffer.allocUnsafe(length);
			const { bytesRead } = await handle.read(chunk, 0, length, position);
			if (!bytesRead) break;
			const read = chunk.subarray(0, bytesRead);
			const last = read.lastIndexOf(10);
			if (last < 0) {
				carry.push(read);
				position += bytesRead;
				continue;
			}
			const held = carry.reduce((sum, part) => sum + part.length, 0);
			const complete = Buffer.concat([...carry, read.subarray(0, last)]);
			// Where `complete` starts in the file, so each line's byte offset can be kept for direct reads.
			const base = position - held;
			const consumed = position + last + 1;
			carry = [read.subarray(last + 1)];
			db.exec("begin");
			try {
				for (let start = 0; start < complete.length; ) {
					const found = complete.indexOf(10, start);
					const end = found < 0 ? complete.length : found;
					const offset = base + start;
					const bytes = end - start;
					const text = complete.subarray(start, end).toString();
					start = end + 1;
					if (!text) continue;
					let parsed: Record<string, any>;
					try {
						parsed = JSON.parse(text);
					} catch {
						continue;
					}
					// Every message record takes the next ordinal, searchable or not, as load-messages.ts counts them.
					const ordinal = parsed?.type === "message" && parsed.message ? messages++ : null;
					const entry = indexedEntry(parsed);
					if (!entry || !(entry.words || entry.calls || entry.results)) continue;
					insert.run(
						entry.words,
						entry.calls,
						entry.results,
						scope,
						sessionId,
						entry.entryId,
						entry.at,
						entry.role,
						ordinal,
						entry.echo ? 1 : 0,
						offset,
						bytes,
					);
				}
				mark.run(sessionId, file, ino, consumed, messages);
				db.exec("commit");
			} catch (error) {
				db.exec("rollback");
				throw error;
			}
			position += bytesRead;
			await new Promise((resolve) => setImmediate(resolve));
		}
		if (!known && position === 0) mark.run(sessionId, file, ino, 0, 0);
	} finally {
		await handle.close();
	}
}

export interface SearchRequest {
	query: string;
	/** Sessions to search; all when absent. */
	sessions?: string[];
	/** Each session's entries between these times (inclusive), as task spans give them. */
	spans?: { session: string; from: number; to: number }[];
	/** Entries never to return, applied before ranking limits: off-lineage entries, the search's own call. */
	exclude?: { session: string; entries: string[] }[];
	/** `words` searches only what people and agents wrote; `all` also tool calls and results. */
	fields?: "words" | "all";
	limit?: number;
	/** Ranked hits to skip, for paging. */
	offset?: number;
}

export interface SearchHit {
	session: string;
	entry: string;
	at: number;
	role: string;
	/** A message entry's `#N`; null for other records. */
	ordinal: number | null;
	/** The entry's line in its transcript, for one direct read of its body. */
	offset: number;
	length: number;
	snippet: string;
	score: number;
}

/**
 * The query's words as FTS5 phrases, any of which may match; bm25 ranks entries holding more of them, and rarer ones,
 * higher. Quoting keeps punctuation and FTS5 operators in the query literal.
 */
function ftsQuery(query: string, fields: "words" | "all", sessions: string[]): string | undefined {
	const terms = query.match(/[\p{L}\p{N}_]+/gu);
	if (!terms?.length) return undefined;
	const any = terms.map((term) => `"${term}"`).join(" OR ");
	const text = fields === "words" ? `words : (${any})` : `{words calls results} : (${any})`;
	if (!sessions.length) return text;
	return `(${text}) AND scope : (${sessions.map((id) => `"${scopeToken(id)}"`).join(" OR ")})`;
}

/** Ranked entries matching words of `query`, newest first among equal scores. */
export function searchIndex(db: DatabaseSync, request: SearchRequest): SearchHit[] {
	const fields = request.fields ?? "all";
	const eligible = eligibility(request);
	if (!eligible) return [];
	const { where, params } = eligible;
	const limit = request.limit && request.limit > 0 ? request.limit : 20;
	const offset = request.offset && request.offset > 0 ? request.offset : 0;
	// A snippet from each text column; the first that holds a match is shown. Letting FTS5 choose could pick `scope`.
	const columns = fields === "words" ? [0] : [0, 1, 2];
	const snippets = columns
		.map((column) => `snippet(entries, ${column}, '\u00ab', '\u00bb', '\u2026', 24) as snippet${column}`)
		.join(", ");
	const rows = db
		.prepare(
			// The scope column only selects sessions; it weighs nothing in ranking.
			`select session_id, entry_id, at, role, ordinal, offset, length, bm25(entries, 1, 1, 1, 0) as score, ${snippets}
			from entries where ${where} order by echo, score, at desc limit ? offset ?`,
		)
		.all(...params, limit, offset) as {
		session_id: string;
		entry_id: string;
		at: number;
		role: string;
		ordinal: number | null;
		offset: number;
		length: number;
		score: number;
		snippet0: string;
		snippet1?: string;
		snippet2?: string;
	}[];
	return rows.map((row) => ({
		session: row.session_id,
		entry: row.entry_id,
		at: row.at,
		role: row.role,
		ordinal: row.ordinal,
		offset: row.offset,
		length: row.length,
		snippet: [row.snippet0, row.snippet1, row.snippet2].find((text) => text?.includes("\u00ab")) ?? row.snippet0,
		score: row.score,
	}));
}

/** How many entries `request` matches, under the same eligibility as `searchIndex`, for paging. */
export function countIndex(db: DatabaseSync, request: SearchRequest): number {
	const eligible = eligibility(request);
	if (!eligible) return 0;
	return (
		db.prepare(`select count(*) as n from entries where ${eligible.where}`).get(...eligible.params) as { n: number }
	).n;
}

/** The query and every eligibility rule as one WHERE clause, so filtering happens before ranking limits. */
function eligibility(request: SearchRequest): { where: string; params: (string | number)[] } | undefined {
	const sessions = request.sessions?.length
		? request.sessions
		: [...new Set((request.spans ?? []).map((span) => span.session))];
	const match = ftsQuery(request.query, request.fields ?? "all", sessions);
	if (!match) return undefined;
	const where: string[] = ["entries match ?"];
	const params: (string | number)[] = [match];
	if (request.sessions?.length) {
		where.push(`session_id in (${request.sessions.map(() => "?").join(", ")})`);
		params.push(...request.sessions);
	}
	if (request.spans?.length) {
		where.push(`(${request.spans.map(() => "(session_id = ? and at between ? and ?)").join(" or ")})`);
		for (const span of request.spans) params.push(span.session, span.from, span.to);
	}
	for (const excluded of request.exclude ?? []) {
		if (!excluded.entries.length) continue;
		where.push(`not (session_id = ? and entry_id in (${excluded.entries.map(() => "?").join(", ")}))`);
		params.push(excluded.session, ...excluded.entries);
	}
	return { where: where.join(" and "), params };
}

/**
 * The runtime's side of the index: a worker thread (`transcript-indexer.worker.ts`) keeps it current, so tokenizing gigabytes
 * of transcript never holds the runtime's own thread, and searches read it through a separate read-only connection.
 */
export class TranscriptIndexer {
	private readonly path: string;
	private readonly worker: Worker;
	private reader?: DatabaseSync;

	constructor(path: string) {
		this.path = path;
		this.worker = new Worker(new URL("./transcript-indexer.worker.ts", import.meta.url), { workerData: { path } });
		this.worker.on("error", (error) => console.error(`transcript index: ${error.stack ?? error}`));
		this.worker.on("message", (message: { type: string; sessionId?: string; message?: string }) => {
			if (message.type === "error") console.error(`transcript index ${message.sessionId}: ${message.message}`);
		});
		this.worker.unref();
	}

	/** Index what `sessionId`'s transcript holds beyond what was read before. */
	update(sessionId: string, file: string): void {
		this.worker.postMessage({ sessionId, file });
	}

	/** A page of ranked hits, and how many entries match in all. */
	search(request: SearchRequest): { hits: SearchHit[]; total: number } {
		if (!this.reader) {
			this.reader = openIndex(this.path, true);
			// The worker writes while searches read; wait out its short transactions instead of failing.
			this.reader.exec("pragma busy_timeout = 5000");
		}
		return { hits: searchIndex(this.reader, request), total: countIndex(this.reader, request) };
	}

	stop(): void {
		this.reader?.close();
		this.reader = undefined;
		void this.worker.terminate();
	}
}

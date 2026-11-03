// A full-text index of every session's transcript, so recall is one indexed query instead of reading and parsing a
// whole transcript per search. Pi's JSONL stays the source of truth: the index holds each entry's searchable text and
// its address (session, entry id, time); readers drill into the file for the entry itself. The index lives in its own
// database beside the runtime's, written only by the indexer worker (`transcript-indexer.ts`), read by the runtime.
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
}

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
	if (entry.type === "custom" && entry.data !== undefined)
		return { ...base, role: "custom", words: JSON.stringify(entry.data), calls: String(entry.customType ?? "") };
	return undefined;
}

/** How much of a transcript one read takes. */
const CHUNK_BYTES = 4 << 20;

/**
 * Bring one session's rows up to date with its transcript: append what was written since the last read, or start over
 * when the file was replaced or shrank. Yields between chunks so a long backfill never holds the thread.
 */
export async function indexTranscript(db: DatabaseSync, sessionId: string, file: string): Promise<number> {
	const handle = await open(file, "r");
	let added = 0;
	try {
		const { size, ino } = await handle.stat();
		const known = db.prepare("select file, inode, bytes from files where session_id = ?").get(sessionId) as
			| { file: string; inode: number; bytes: number }
			| undefined;
		let position = known?.bytes ?? 0;
		if (known && (known.file !== file || known.inode !== ino || size < known.bytes)) {
			db.prepare("delete from entries where session_id = ?").run(sessionId);
			position = 0;
		}
		const insert = db.prepare(
			"insert into entries (words, calls, results, session_id, entry_id, at, role) values (?, ?, ?, ?, ?, ?, ?)",
		);
		const mark = db.prepare(
			"insert into files (session_id, file, inode, bytes) values (?, ?, ?, ?) on conflict (session_id) do update set file = excluded.file, inode = excluded.inode, bytes = excluded.bytes",
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
			const complete = Buffer.concat([...carry, read.subarray(0, last)]);
			const consumed = position + last + 1;
			carry = [read.subarray(last + 1)];
			db.exec("begin");
			try {
				for (const line of complete.toString().split("\n")) {
					if (!line) continue;
					let entry: IndexedEntry | undefined;
					try {
						entry = indexedEntry(JSON.parse(line));
					} catch {
						continue;
					}
					if (!entry || !(entry.words || entry.calls || entry.results)) continue;
					insert.run(entry.words, entry.calls, entry.results, sessionId, entry.entryId, entry.at, entry.role);
					added++;
				}
				mark.run(sessionId, file, ino, consumed);
				db.exec("commit");
			} catch (error) {
				db.exec("rollback");
				throw error;
			}
			position += bytesRead;
			await new Promise((resolve) => setImmediate(resolve));
		}
		if (!known && position === 0) mark.run(sessionId, file, ino, 0);
	} finally {
		await handle.close();
	}
	return added;
}

export interface SearchRequest {
	query: string;
	/** Sessions to search; all when absent. */
	sessions?: string[];
	/** Each session's entries between these times (inclusive), as task spans give them. */
	spans?: { session: string; from: number; to: number }[];
	/** `words` searches only what people and agents wrote; `all` also tool calls and results. */
	fields?: "words" | "all";
	limit?: number;
}

export interface SearchHit {
	session: string;
	entry: string;
	at: number;
	role: string;
	snippet: string;
	score: number;
}

/**
 * The query's words as FTS5 phrases, any of which may match; bm25 ranks entries holding more of them, and rarer ones,
 * higher. Quoting keeps punctuation and FTS5 operators in the query literal.
 */
function ftsQuery(query: string, fields: "words" | "all"): string | undefined {
	const terms = query.match(/[\p{L}\p{N}_]+/gu);
	if (!terms?.length) return undefined;
	const all = terms.map((term) => `"${term}"`).join(" OR ");
	return fields === "words" ? `words : (${all})` : all;
}

/** Ranked entries matching words of `query`, newest first among equal scores. */
export function searchIndex(db: DatabaseSync, request: SearchRequest): SearchHit[] {
	const fields = request.fields ?? "all";
	const match = ftsQuery(request.query, fields);
	if (!match) return [];
	const limit = request.limit && request.limit > 0 ? request.limit : 20;
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
	const column = fields === "words" ? 0 : -1;
	const rows = db
		.prepare(
			`select session_id, entry_id, at, role, bm25(entries) as score,
				snippet(entries, ${column}, '\u00ab', '\u00bb', '\u2026', 24) as snippet
			from entries where ${where.join(" and ")} order by score, at desc limit ?`,
		)
		.all(...params, limit) as {
		session_id: string;
		entry_id: string;
		at: number;
		role: string;
		score: number;
		snippet: string;
	}[];
	return rows.map((row) => ({
		session: row.session_id,
		entry: row.entry_id,
		at: row.at,
		role: row.role,
		snippet: row.snippet,
		score: row.score,
	}));
}

/**
 * The runtime's side of the index: a worker thread (`transcript-indexer.ts`) keeps it current, so tokenizing gigabytes
 * of transcript never holds the runtime's own thread, and searches read it through a separate read-only connection.
 */
export class TranscriptIndexer {
	private readonly path: string;
	private readonly worker: Worker;
	private reader?: DatabaseSync;

	constructor(path: string) {
		this.path = path;
		this.worker = new Worker(new URL("./transcript-indexer.ts", import.meta.url), { workerData: { path } });
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

	search(request: SearchRequest): SearchHit[] {
		this.reader ??= openIndex(this.path, true);
		return searchIndex(this.reader, request);
	}

	stop(): void {
		this.reader?.close();
		this.reader = undefined;
		void this.worker.terminate();
	}
}

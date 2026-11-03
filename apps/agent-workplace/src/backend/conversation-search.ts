import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { ConversationHit, ConversationSearch } from "../world.js";
import { transcriptEntry } from "./transcript.js";

const PER_FILE = 50;

function sessionFiles(db: string): Map<string, string> {
	const reader = new DatabaseSync(db, { readOnly: true });
	try {
		const rows = reader
			.prepare("select id, session_file from sessions where session_file is not null and retired_at is null")
			.all() as { id: string; session_file: string }[];
		return new Map(rows.filter((row) => existsSync(row.session_file)).map((row) => [row.session_file, row.id]));
	} finally {
		reader.close();
	}
}

function ripgrep(query: string, files: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			"rg",
			[
				"--fixed-strings",
				"--ignore-case",
				"--no-messages",
				"--null",
				"--with-filename",
				"-m",
				String(PER_FILE),
				"--",
				query,
				...files,
			],
			{ maxBuffer: 256 * 1024 * 1024 },
			(error, stdout) => {
				if (error && (error as { code?: unknown }).code !== 1) reject(error);
				else resolve(stdout);
			},
		);
	});
}

function snippet(text: string, query: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	const at = flat.toLowerCase().indexOf(query.toLowerCase());
	const start = Math.max(0, at - 60);
	return `${start > 0 ? "\u2026" : ""}${flat.slice(start, start + 200)}${start + 200 < flat.length ? "\u2026" : ""}`;
}

export async function searchConversations(db: string, query: string, limit: number): Promise<ConversationSearch> {
	const words = query.trim();
	if (words.length < 3) return { ok: true, hits: [] };
	const files = sessionFiles(db);
	if (!files.size) return { ok: true, hits: [] };
	let output: string;
	try {
		output = await ripgrep(words, [...files.keys()]);
	} catch (error) {
		const missing = (error as { code?: unknown }).code === "ENOENT";
		return { ok: false, reason: missing ? "DM search needs ripgrep (rg) on the PATH." : String(error) };
	}
	const hits: ConversationHit[] = [];
	for (const line of output.split("\n")) {
		const split = line.indexOf("\0");
		if (split < 0) continue;
		const session = files.get(line.slice(0, split));
		if (!session) continue;
		let entry: ReturnType<typeof transcriptEntry>;
		try {
			entry = transcriptEntry(JSON.parse(line.slice(split + 1)));
		} catch {
			continue;
		}
		const text =
			entry?.kind === "user"
				? entry.text
				: entry?.kind === "assistant"
					? entry.parts.flatMap((part) => (part.kind === "text" ? [part.text] : [])).join("\n")
					: "";
		if (!entry || !text.toLowerCase().includes(words.toLowerCase())) continue;
		hits.push({
			session,
			entry: entry.id,
			at: entry.at,
			speaker: entry.kind === "user" ? "operator" : session,
			text: snippet(text, words),
		});
	}
	return { ok: true, hits: hits.sort((a, b) => b.at - a.at).slice(0, limit) };
}

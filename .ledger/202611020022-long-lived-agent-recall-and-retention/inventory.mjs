import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

// All per-file paths remain in a caller-selected private output directory.
const [root, output] = process.argv.slice(2);
if (!root || !output || resolve(output) === process.cwd() || resolve(output).startsWith(`${process.cwd()}/`))
	throw new Error("Use a private output directory outside the repository.");
async function files(dir) {
	const out = [];
	for (const e of await readdir(dir, { withFileTypes: true })) {
		if (e.isDirectory()) out.push(...(await files(join(dir, e.name))));
		else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(join(dir, e.name));
	}
	return out;
}
const rows = [];
const kinds = {};
const kindBytes = {};
const tools = {};
const custom = {};
const customMessages = {};
const started = Date.now();
for (const path of await files(root)) {
	const before = await stat(path);
	const row = {
		key: createHash("sha256").update(path).digest("hex").slice(0, 12),
		path,
		bytes: before.size,
		messages: 0,
		entries: 0,
		malformed: 0,
		compactions: 0,
		notebook: 0,
		search: 0,
		revisit: 0,
		mailSearch: 0,
		first: null,
		last: null,
	};
	for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
		if (!line.trim()) continue;
		let e;
		try {
			e = JSON.parse(line);
		} catch {
			row.malformed++;
			continue;
		}
		row.entries++;
		kinds[e.type] = (kinds[e.type] || 0) + 1;
		kindBytes[e.type] = (kindBytes[e.type] || 0) + Buffer.byteLength(line) + 1;
		if (e.type === "custom_message") customMessages[e.customType] = (customMessages[e.customType] || 0) + 1;
		const ts = Date.parse(e.timestamp);
		if (Number.isFinite(ts)) {
			row.first = row.first === null ? ts : Math.min(row.first, ts);
			row.last = Math.max(row.last || ts, ts);
		}
		if (e.type === "compaction") row.compactions++;
		if (e.type === "custom") {
			custom[e.customType] = (custom[e.customType] || 0) + 1;
			if (/notebook/.test(e.customType)) row.notebook++;
		}
		if (e.type !== "message") continue;
		row.messages++;
		for (const p of Array.isArray(e.message?.content) ? e.message.content : []) {
			if (p.type !== "toolCall") continue;
			tools[p.name] = (tools[p.name] || 0) + 1;
			if (p.name === "search_session") row.search++;
			if (p.name === "revisit_note") row.revisit++;
			if (p.name === "search_messages") row.mailSearch++;
		}
	}
	const after = await stat(path);
	row.changedDuringRead = before.size !== after.size || before.mtimeMs !== after.mtimeMs;
	rows.push(row);
}
rows.sort((a, b) => b.bytes - a.bytes);
await writeFile(join(output, "inventory-private.json"), JSON.stringify(rows));
const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
const summary = {
	measuredAt: new Date().toISOString(),
	elapsedMs: Date.now() - started,
	files: rows.length,
	bytes: sum("bytes"),
	entries: sum("entries"),
	messages: sum("messages"),
	malformed: sum("malformed"),
	changedDuringRead: rows.filter((r) => r.changedDuringRead).length,
	compactions: sum("compactions"),
	filesWithCompactions: rows.filter((r) => r.compactions).length,
	filesWithSearch: rows.filter((r) => r.search).length,
	searchCalls: sum("search"),
	revisitCalls: sum("revisit"),
	mailSearchCalls: sum("mailSearch"),
	entryKinds: kinds,
	entryBytes: kindBytes,
	customMessageKinds: customMessages,
	notebookCustomKinds: Object.fromEntries(Object.entries(custom).filter(([k]) => /notebook/.test(k))),
	topFiles: rows
		.slice(0, 12)
		.map(({ path, ...r }) => ({ ...r, spanDays: r.last && r.first ? (r.last - r.first) / 86400000 : null })),
	toolCalls: Object.fromEntries(
		Object.entries(tools).filter(([k]) =>
			["search_session", "revisit_note", "search_messages", "update_notebook"].includes(k),
		),
	),
};
await writeFile(join(output, "inventory-aggregate.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

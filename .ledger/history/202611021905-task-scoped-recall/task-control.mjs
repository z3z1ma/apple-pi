import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sha256, sourceIdentity } from "./engine-replay.mjs";

export const sourceAddress = (session, entry) => `${session}:${entry}`;

export function taskCorpus(question) {
	return question.corpus.map((source) => {
		const records = readFileSync(source.session_path, "utf8").split("\n").filter(Boolean).map(JSON.parse);
		const prefix = records.slice(0, source.prefix_cutoff_line_1based);
		const text = `${prefix.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
		if (prefix.at(-1)?.id !== source.prefix_cutoff_entry_id || sha256(text) !== source.normalized_prefix_sha256)
			throw new Error("Task source prefix changed");
		if (Date.parse(source.prefix_cutoff_at) > Date.parse(question.cutoff_at))
			throw new Error("Task source after question cutoff");
		const byId = new Map(prefix.map((entry) => [entry.id, entry]));
		const active = new Set();
		let id = source.prefix_cutoff_entry_id;
		while (id && !active.has(id)) {
			active.add(id);
			const entry = byId.get(id);
			if (!entry) throw new Error("Task source ancestry unavailable");
			id = entry.parentId;
		}
		if (id) throw new Error("Task source ancestry cycle");
		const eligible = new Set();
		for (const span of source.eligible_spans) {
			const entries = prefix.slice(span.from_line - 1, span.to_line);
			if (
				!question.retrieval.tasks.includes(span.task_id) ||
				entries[0]?.id !== span.from_entry ||
				entries.at(-1)?.id !== span.to_entry ||
				sha256(`${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`) !== span.normalized_records_sha256
			)
				throw new Error("Task span changed or outside declared tasks");
			for (const entry of entries) {
				if (question.params.scope !== "all" && !active.has(entry.id)) continue;
				const issuer =
					question.tool_call_id &&
					entry.message?.role === "assistant" &&
					Array.isArray(entry.message.content) &&
					entry.message.content.some(
						(part) =>
							part.type === "toolCall" &&
							(part.id === question.tool_call_id || question.tool_call_id.startsWith(`${part.id}/`)),
					);
				if (!issuer) eligible.add(entry.id);
			}
		}
		for (const label of question.episode.labels.filter((row) => row.session_id === source.session_id)) {
			const record = byId.get(label.entry_id);
			if (!eligible.has(label.entry_id) || sha256(JSON.stringify(record)) !== label.record_sha256)
				throw new Error("Task gold outside eligible corpus or changed");
		}
		return { source, prefix, text, active, eligible };
	});
}

export async function currentTaskControl(question, sourceRoot, scratch) {
	const { loadAllMessages } = await import(
		pathToFileURL(join(sourceRoot, "components/session-search/src/load-messages.ts"))
	);
	const { searchEntries } = await import(
		pathToFileURL(join(sourceRoot, "components/session-search/src/search-entries.ts"))
	);
	const { formatRecallOutput } = await import(
		pathToFileURL(join(sourceRoot, "components/session-search/src/format-recall.ts"))
	);
	const rows = [];
	const origins = new Map();
	for (const [offset, corpus] of taskCorpus(question).entries()) {
		const file = join(scratch, `${offset}.jsonl`);
		writeFileSync(file, corpus.text, { mode: 0o600 });
		const loaded = loadAllMessages(file, false, corpus.eligible, undefined, corpus.active);
		for (const [index, entry] of loaded.rendered.entries()) {
			const address = sourceAddress(corpus.source.session_id, entry.entryId);
			if (origins.has(address)) throw new Error("Duplicate task source address");
			origins.set(address, { session: corpus.source.session_id, entry: entry.entryId, index: entry.index });
			rows.push({ rendered: { ...entry, entryId: address }, message: loaded.rawMessages[index] });
		}
	}
	rows.sort((a, b) => String(a.rendered.timestamp).localeCompare(String(b.rendered.timestamp)));
	const hits = searchEntries(
		rows.map((row) => row.rendered),
		rows.map((row) => row.message),
		question.params.query,
	).slice(0, 5);
	return {
		id: question.id,
		addresses: hits.map((hit) => hit.entryId),
		sources: hits.map((hit) => origins.get(hit.entryId)),
		text: hits
			.map(
				(hit) =>
					`Source session+entry: ${hit.entryId}\n${formatRecallOutput([{ ...hit, entryId: origins.get(hit.entryId).entry }], question.params.query)}`,
			)
			.join("\n\n"),
		controlKind: "current-algorithm-on-explicit-multi-source-task-corpus",
		actualExistingTool: false,
	};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [goldPath, output, sourceRoot] = process.argv.slice(2);
	if (!goldPath || !output || !sourceRoot || !resolve(output).startsWith("/tmp/"))
		throw new Error("Pass PRIVATE_GOLD /tmp/PRIVATE_OUTPUT BASELINE_ROOT");
	const goldBytes = readFileSync(goldPath);
	const gold = JSON.parse(goldBytes);
	const identity = sourceIdentity(sourceRoot, "components/session-search/src");
	const scratch = mkdtempSync("/tmp/task-control-");
	const results = [];
	try {
		for (const question of gold.questions) results.push(await currentTaskControl(question, sourceRoot, scratch));
		if (JSON.stringify(identity) !== JSON.stringify(sourceIdentity(sourceRoot, "components/session-search/src")))
			throw new Error("Task control source changed");
		writeFileSync(output, JSON.stringify({ goldSha256: sha256(goldBytes), identity, results }, null, 2), {
			mode: 0o600,
		});
		console.log(
			JSON.stringify({
				questions: results.length,
				control: "explicit multi-source current algorithm; not an existing tool capability",
			}),
		);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

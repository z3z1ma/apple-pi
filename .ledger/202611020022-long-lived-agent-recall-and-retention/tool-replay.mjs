import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

let root = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(root, "package.json"))) {
	const parent = dirname(root);
	if (parent === root) throw new Error("Repository root not found");
	root = parent;
}
const [goldPath, output, label, migration = "unchanged", sourceRoot = root] = process.argv.slice(2);
const { sessionSearchTool } = await import(pathToFileURL(join(sourceRoot, "components/session-search/src/tool.ts")));
if (!goldPath || !output || !label || resolve(output) === root || resolve(output).startsWith(`${root}/`))
	throw new Error("Pass private gold, private output directory, and measurement label.");
if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Use a simple measurement label.");
if (!["unchanged", "explicit-regex"].includes(migration)) throw new Error("Unknown migration.");
const gold = JSON.parse(readFileSync(goldPath, "utf8"));
const rows = [];
const privateRows = [];
const snapshotDir = mkdtempSync(join(output, "snapshots-"));
try {
	for (const question of gold.questions) {
		const entries = readFileSync(question.session_path, "utf8")
			.split("\n")
			.filter(Boolean)
			.flatMap((line) => {
				try {
					return [JSON.parse(line)];
				} catch {
					return [];
				}
			});
		const cutoff = entries.findIndex((entry) => entry.id === question.issuing_entry_id);
		if (cutoff < 0) throw new Error("Historical issuer unavailable");
		const prefix = entries.slice(0, cutoff + 1);
		const byId = new Map(prefix.map((entry) => [entry.id, entry]));
		const messages = prefix.filter((entry) => entry.type === "message" && entry.message);
		const branch = [];
		const visited = new Set();
		let id = question.issuing_entry_id;
		while (id && !visited.has(id)) {
			visited.add(id);
			const entry = byId.get(id);
			if (!entry) break;
			branch.unshift(entry);
			id = entry.parentId;
		}
		const snapshot = join(snapshotDir, `${question.id}.jsonl`);
		writeFileSync(snapshot, `${prefix.map((entry) => JSON.stringify(entry)).join("\n")}\n`, { mode: 0o600 });
		const params = { ...question.params };
		if (migration === "explicit-regex" && /[|*+?{}()[\]\\^$.]/.test(params.query))
			params.query = `regex:${params.query}`;
		const start = performance.now();
		const result = await sessionSearchTool.execute(question.tool_call_id, params, undefined, undefined, {
			sessionManager: { getSessionFile: () => snapshot, getBranch: () => branch, getEntries: () => prefix },
		});
		const elapsedMs = performance.now() - start;
		const text = result.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n");
		// Prefer production provenance metadata; old releases expose only printed message ordinals.
		const sourceHits = result.details?.hits ?? result.details?.sources;
		const hits = Array.isArray(sourceHits)
			? sourceHits.map((hit) => ({
					entryId: hit.entryId ?? hit.id,
					index: hit.index,
				}))
			: [...text.matchAll(/^>\s+(?:#(\d+)|entry:([^\s]+))\s+\[/gm)].map((match) => ({
					entryId: match[2] ?? messages[Number(match[1])]?.id,
					index: match[1] === undefined ? undefined : Number(match[1]),
				}));
		const unique = [...new Map(hits.filter((hit) => hit.entryId).map((hit) => [hit.entryId, hit])).values()].slice(
			0,
			5,
		);
		const labels = new Map(
			[...question.episode.labels, ...question.historical_top5].map((entry) => [entry.entry_id, entry.relevant]),
		);
		const relevant = new Set(question.complete_episode_relevant_ids);
		const evaluated = unique.map((hit) => ({
			...hit,
			relevant: labels.get(hit.entryId) ?? null,
			episodeRelevant: relevant.has(hit.entryId),
		}));
		rows.push({
			id: question.id,
			migration,
			returnedAt5: evaluated.length,
			knownRelevantAt5: evaluated.filter((hit) => hit.relevant).length,
			unjudgedAt5: evaluated.filter((hit) => hit.relevant === null).length,
			episodeRelevantAt5: evaluated.filter((hit) => hit.episodeRelevant).length,
			episodeGold: relevant.size,
			elapsedMs,
			responseBytes: Buffer.byteLength(text),
			isError: result.isError ?? false,
		});
		privateRows.push({
			id: question.id,
			question_intent: question.question_intent,
			originalParams: question.params,
			params,
			text,
			details: result.details,
			hits: evaluated.map((hit) => ({ ...hit, fullEntry: byId.get(hit.entryId) })),
		});
		rmSync(snapshot);
	}
} finally {
	rmSync(snapshotDir, { recursive: true, force: true });
}
writeFileSync(join(output, `${label}-private.json`), JSON.stringify(privateRows, null, 2), { mode: 0o600 });
writeFileSync(join(output, `${label}-aggregate.json`), JSON.stringify(rows, null, 2), { mode: 0o600 });
console.log(JSON.stringify(rows, null, 2));

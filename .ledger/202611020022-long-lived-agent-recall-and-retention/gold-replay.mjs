import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let root = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(root, "package.json"))) {
	const p = dirname(root);
	if (p === root) throw new Error("Repository not found");
	root = p;
}
const { searchEntries } = await import(pathToFileURL(join(root, "components/session-search/src/search-entries.ts")));
const { renderMessage } = await import(pathToFileURL(join(root, "components/session-search/src/render-entries.ts")));
const [goldPath, output] = process.argv.slice(2);
if (!goldPath || !output || resolve(output) === root || resolve(output).startsWith(`${root}/`))
	throw new Error("Use private gold and output paths.");
const gold = JSON.parse(readFileSync(goldPath, "utf8"));
const privateRows = [];
const aggregate = [];
for (const q of gold.questions) {
	const entries = readFileSync(q.session_path, "utf8")
		.split("\n")
		.filter(Boolean)
		.flatMap((l) => {
			try {
				return [JSON.parse(l)];
			} catch {
				return [];
			}
		});
	const byId = new Map(entries.map((e) => [e.id, e]));
	const cutoff = entries.findIndex((e) => e.id === q.issuing_entry_id);
	if (cutoff < 0) throw new Error("Issuing entry missing");
	const issuer = entries[cutoff];
	const allowed = new Set([issuer.id]);
	let parent = issuer.parentId;
	while (parent && !allowed.has(parent)) {
		allowed.add(parent);
		parent = byId.get(parent)?.parentId;
	}
	const indexed = [];
	let index = 0;
	for (let p = 0; p < entries.length; p++) {
		const e = entries[p];
		if (e.type === "message" && e.message) indexed.push({ e, index: index++, pos: p });
	}
	const labels = new Map([...q.episode.labels, ...q.historical_top5].map((x) => [x.entry_id, x.relevant]));
	const relevant = new Set(q.complete_episode_relevant_ids);
	const qRows = { id: q.id, cutoffFound: true, episodeGold: relevant.size, variants: {} };
	const qPrivate = {
		id: q.id,
		question_intent: q.question_intent,
		query: q.query ?? q.params.query,
		session_path: q.session_path,
		variants: {},
	};
	for (const variant of ["deployed", "exclude-issuer"]) {
		const docs = indexed.filter(
			(r) =>
				r.pos <= (variant === "deployed" ? cutoff : cutoff - 1) && (q.params.scope === "all" || allowed.has(r.e.id)),
		);
		const hits = searchEntries(
			docs.map((r) => renderMessage(r.e.message, r.index)),
			docs.map((r) => r.e.message),
			q.query ?? q.params.query,
			q.params.mode === "file" ? "file" : "history",
		);
		const hitByIndex = new Map(indexed.map((r) => [r.index, r.e]));
		const evaluated = hits.slice(0, 25).map((h) => ({
			entry_id: hitByIndex.get(h.index).id,
			index: h.index,
			relevant: labels.get(hitByIndex.get(h.index).id) ?? null,
			episodeRelevant: relevant.has(hitByIndex.get(h.index).id),
		}));
		const top5 = evaluated.slice(0, 5);
		qRows.variants[variant] = {
			hits: hits.length,
			top5: top5.map((h) => ({ entry_id: h.entry_id, relevant: h.relevant, episodeRelevant: h.episodeRelevant })),
			knownRelevantAt5: top5.filter((h) => h.relevant).length,
			unjudgedAt5: top5.filter((h) => h.relevant === null).length,
			episodeRelevantAt5: top5.filter((h) => h.episodeRelevant).length,
			episodeRelevantAt25: evaluated.filter((h) => h.episodeRelevant).length,
		};
		qPrivate.variants[variant] = hits.slice(0, 5).map((h) => ({
			entry_id: hitByIndex.get(h.index).id,
			index: h.index,
			label: labels.get(hitByIndex.get(h.index).id) ?? null,
			snippet: h.snippet,
			full: renderMessage(hitByIndex.get(h.index).message, h.index, true).summary,
		}));
	}
	aggregate.push(qRows);
	privateRows.push(qPrivate);
}
writeFileSync(join(output, "gold-replay-private.json"), JSON.stringify(privateRows, null, 2), { mode: 0o600 });
// IDs in this private aggregate are source locators. Public reports use only Q labels and counts.
writeFileSync(join(output, "gold-replay-locators.json"), JSON.stringify(aggregate, null, 2), { mode: 0o600 });
console.log(
	JSON.stringify(
		aggregate.map(({ variants, ...q }) => ({
			...q,
			variants: Object.fromEntries(Object.entries(variants).map(([k, { top5, ...v }]) => [k, v])),
		})),
		null,
		2,
	),
);

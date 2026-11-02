import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

let repository = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(repository, "package.json"))) {
	const parent = dirname(repository);
	if (parent === repository) throw new Error("Repository root not found");
	repository = parent;
}
const { searchEntries } = await import(
	pathToFileURL(join(repository, "components/session-search/src/search-entries.ts"))
);
const { renderMessage } = await import(
	pathToFileURL(join(repository, "components/session-search/src/render-entries.ts"))
);
const { sessionSearchTool } = await import(pathToFileURL(join(repository, "components/session-search/src/tool.ts")));

const [output] = process.argv.slice(2);
if (!output || resolve(output) === repository || resolve(output).startsWith(`${repository}/`))
	throw new Error("Use a private output directory.");
const inventory = JSON.parse(readFileSync(join(output, "inventory-private.json"), "utf8"));
// This workload deliberately selects long, repeatedly compacted sessions rather than claiming population sampling.
const selected = inventory.filter((r) => r.search && r.compactions && r.last - r.first > 3 * 86400000);
const privateRows = [];
const latencies = [];
const fileRows = [];
const callsOf = (e) =>
	e.type === "message" && Array.isArray(e.message?.content)
		? e.message.content.filter((p) => p.type === "toolCall" && p.name === "search_session")
		: [];
const aggregate = (a) => {
	const b = [...a].sort((x, y) => x - y);
	return {
		n: b.length,
		min: b[0] ?? null,
		median: b[Math.floor(b.length / 2)] ?? null,
		p95: b[Math.min(b.length - 1, Math.ceil(b.length * 0.95) - 1)] ?? null,
		max: b.at(-1) ?? null,
	};
};
for (const row of selected) {
	const t0 = performance.now();
	const before = statSync(row.path);
	const text = readFileSync(row.path, "utf8");
	const entries = text
		.split("\n")
		.filter(Boolean)
		.flatMap((l) => {
			try {
				return [JSON.parse(l)];
			} catch {
				return [];
			}
		});
	const parseMs = performance.now() - t0;
	const byId = new Map(entries.map((e) => [e.id, e]));
	const indexed = [];
	let index = 0;
	for (let pos = 0; pos < entries.length; pos++) {
		const e = entries[pos];
		if (e.type === "message" && e.message) indexed.push({ e, index: index++, pos });
	}
	const calls = entries.flatMap((e, pos) => callsOf(e).map((c) => ({ c, e, pos })));
	let seen = 0;
	for (let ci = 0; ci < calls.length; ci++) {
		const { c, e, pos } = calls[ci];
		const p = c.arguments ?? {};
		const query = p.query?.trim();
		const base = {
			file: row.key,
			callId: c.id,
			position: pos,
			parameters: p,
			kind: query?.startsWith("#")
				? "file-address"
				: query?.startsWith("call:")
					? "call-address"
					: !query && p.expand?.length
						? "expand"
						: p.mode === "touched"
							? "touched"
							: query
								? "topical"
								: "browse",
		};
		if (base.kind !== "topical") {
			privateRows.push(base);
			continue;
		}
		// Exclude the entire issuing assistant entry, not merely its search call, to avoid self-query leakage.
		const allowed = new Set();
		let ancestor = e.parentId;
		while (ancestor && !allowed.has(ancestor)) {
			allowed.add(ancestor);
			ancestor = byId.get(ancestor)?.parentId;
		}
		const docs = indexed.filter((r) => r.pos < pos && (p.scope === "all" || allowed.has(r.e.id)));
		const raw = docs.map((r) => r.e.message);
		const rendered = docs.map((r) => renderMessage(r.e.message, r.index, false));
		const start = performance.now();
		let hits = [],
			error = null;
		try {
			hits = searchEntries(rendered, raw, query, p.mode === "file" ? "file" : "history");
		} catch (err) {
			error = String(err);
		}
		const searchMs = performance.now() - start;
		// Subsequent direct navigation supplies a behavioral target, NOT a relevance gold label.
		const targets = [];
		for (let cj = ci + 1; cj < Math.min(calls.length, ci + 4); cj++) {
			const later = calls[cj].c.arguments ?? {};
			if (later.query && !later.query.startsWith("#") && !later.query.startsWith("call:")) break;
			for (const n of later.expand ?? []) if (n < index && !targets.includes(n)) targets.push(n);
			const m = /^#(\d+):/.exec(later.query ?? "");
			if (m && !targets.includes(+m[1])) targets.push(+m[1]);
		}
		const ranks = targets.map((n) => ({
			index: n,
			rank: hits.findIndex((h) => h.index === n) + 1,
			available: docs.some((d) => d.index === n),
		}));
		// The deployed tool can also see its issuing assistant message. Measure that contamination separately.
		const issuer = indexed.find((r) => r.e.id === e.id);
		const deployedDocs = issuer ? [...docs, issuer] : docs;
		let deployedHits = [];
		try {
			deployedHits = searchEntries(
				deployedDocs.map((r) => renderMessage(r.e.message, r.index, false)),
				deployedDocs.map((r) => r.e.message),
				query,
				p.mode === "file" ? "file" : "history",
			);
		} catch {}
		const out = {
			...base,
			regex: /[|*+?{}()[\]\\^$.]/.test(query),
			messages: docs.length,
			searchMs,
			error,
			hits: hits.map((h) => h.index),
			targets: ranks,
			issuerIndex: issuer?.index,
			deployedHits: deployedHits.map((h) => h.index),
			issuerRank: deployedHits.findIndex((h) => h.index === issuer?.index) + 1,
		};
		privateRows.push(out);
		latencies.push(searchMs);
		seen++;
	}
	const after = statSync(row.path);
	fileRows.push({
		key: row.key,
		bytes: before.size,
		messages: indexed.length,
		parseMs,
		topicalQueries: seen,
		changedDuringRead: before.size !== after.size || before.mtimeMs !== after.mtimeMs,
	});
	// Exercise the full production tool on the current file without opening SessionManager (which can write on load).
	if (fileRows.length <= 3) {
		const leaf = entries.at(-1);
		const branch = [];
		let id = leaf?.id;
		const seenIds = new Set();
		while (id && !seenIds.has(id)) {
			seenIds.add(id);
			const e = byId.get(id);
			if (!e) break;
			branch.push(e);
			id = e.parentId;
		}
		const testQuery = calls.find((x) => x.c.arguments?.query && !/^(#|call:)/.test(x.c.arguments.query))?.c.arguments;
		if (testQuery) {
			const runs = [];
			for (let n = 0; n < 3; n++) {
				const st = performance.now();
				const result = await sessionSearchTool.execute("measurement", testQuery, undefined, undefined, {
					sessionManager: { getSessionFile: () => row.path, getBranch: () => branch, getEntries: () => entries },
				});
				runs.push({
					ms: performance.now() - st,
					outputBytes: Buffer.byteLength(result.content.map((p) => p.text ?? "").join("")),
				});
			}
			fileRows.at(-1).fullToolRuns = runs;
		}
	}
	console.log(JSON.stringify({ file: row.key, topicalQueries: seen, parseMs }));
}
const topical = privateRows.filter((r) => r.kind === "topical");
const anchored = topical.filter((r) => r.targets.some((t) => t.available));
const summary = {
	measuredAt: new Date().toISOString(),
	selectedFiles: selected.length,
	calls: privateRows.length,
	kinds: Object.fromEntries(
		[...new Set(privateRows.map((r) => r.kind))].map((k) => [k, privateRows.filter((r) => r.kind === k).length]),
	),
	topical: {
		n: topical.length,
		regex: topical.filter((r) => r.regex).length,
		errors: topical.filter((r) => r.error).length,
		zeroHits: topical.filter((r) => !r.error && !r.hits.length).length,
		returned50: topical.filter((r) => r.hits.length === 50).length,
		searchMs: aggregate(latencies),
		issuerInTop5: topical.filter((r) => r.issuerRank > 0 && r.issuerRank <= 5).length,
		issuerRank1: topical.filter((r) => r.issuerRank === 1).length,
	},
	navigationProxy: {
		queries: anchored.length,
		hitAt5: anchored.filter((r) => r.targets.some((t) => t.rank > 0 && t.rank <= 5)).length,
		hitAt25: anchored.filter((r) => r.targets.some((t) => t.rank > 0 && t.rank <= 25)).length,
		hitAt50: anchored.filter((r) => r.targets.some((t) => t.rank > 0 && t.rank <= 50)).length,
		note: "Subsequently expanded entries are behavior-derived targets, not independently judged relevance or exhaustive gold. Timing excludes JSON parsing/rendering except fullToolRuns.",
	},
	files: fileRows,
};
writeFileSync(join(output, "replay-private.json"), JSON.stringify(privateRows));
writeFileSync(join(output, "replay-aggregate.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

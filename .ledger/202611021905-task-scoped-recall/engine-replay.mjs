import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const isRegex = (query) => /[|*+?{}()[\]\\^$.]/.test(query);

export function historicalPrefix(question) {
	const records = readFileSync(question.session_path, "utf8").split("\n").filter(Boolean).map(JSON.parse);
	const cutoff = records.findIndex((entry) => entry.id === question.issuing_entry_id);
	if (cutoff < 0) throw new Error("Historical cutoff unavailable");
	const prefix = records.slice(0, cutoff + 1);
	const byId = new Map(prefix.filter((entry) => entry.id).map((entry) => [entry.id, entry]));
	if (byId.size !== prefix.filter((entry) => entry.id).length) throw new Error("Duplicate prefix identity");
	const branch = [];
	const visited = new Set();
	let id = question.issuing_entry_id;
	while (id && !visited.has(id)) {
		visited.add(id);
		const entry = byId.get(id);
		if (!entry) throw new Error("Broken historical ancestry");
		branch.unshift(entry);
		id = entry.parentId;
	}
	if (id) throw new Error("Cyclic historical ancestry");
	const text = `${prefix.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
	if (question.cutoff?.prefix_sha256 && sha256(text) !== question.cutoff.prefix_sha256)
		throw new Error("Frozen normalized prefix hash changed");
	for (const label of question.episode.labels) {
		if (!byId.has(label.entry_id)) throw new Error("Gold source outside historical prefix");
		if (label.record_sha256 && sha256(JSON.stringify(byId.get(label.entry_id))) !== label.record_sha256)
			throw new Error("Frozen source hash changed");
	}
	return { prefix, branch, byId, text };
}

export function eligibleProjection(prefix, branch, question) {
	const active = new Set(branch.map((entry) => entry.id));
	return prefix.filter((entry) => {
		if (entry.type === "session") return true;
		if (question.params.scope !== "all" && !active.has(entry.id)) return false;
		return !(
			entry.message?.role === "assistant" &&
			Array.isArray(entry.message.content) &&
			entry.message.content.some(
				(part) =>
					part.type === "toolCall" &&
					(part.id === question.tool_call_id || question.tool_call_id.startsWith(`${part.id}/`)),
			)
		);
	});
}

export async function currentEngine(sourceRoot) {
	const { sessionSearchTool } = await import(pathToFileURL(join(sourceRoot, "components/session-search/src/tool.ts")));
	return async (file, query, { question, prefix, branch, limit = 5 }) => {
		if (limit !== 5 || (question.params.page ?? 1) !== 1 || (question.params.mode ?? "history") !== "history")
			throw new Error("This comparison requires the original first five history results");
		const result = await sessionSearchTool.execute(
			question.tool_call_id,
			{ ...question.params, query },
			undefined,
			undefined,
			{
				sessionManager: { getSessionFile: () => file, getBranch: () => branch, getEntries: () => prefix },
			},
		);
		if (result.isError) throw new Error("Baseline tool returned an error");
		const sources = result.details?.hits ?? result.details?.sources;
		if (!Array.isArray(sources)) throw new Error("Baseline returned no ranked provenance metadata");
		return {
			ids: sources.map((hit) => hit.entryId ?? hit.id),
			text: result.content
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("\n"),
			details: result.details,
			actualToolDisplay: true,
		};
	};
}

export async function indexEngine(sourceRoot, file, scratch) {
	const { openIndex, indexTranscript, searchIndex } = await import(
		pathToFileURL(join(sourceRoot, "components/session-state/src/transcript-index.ts"))
	);
	const dbPath = join(scratch, "index.sqlite");
	const db = openIndex(dbPath);
	try {
		const started = performance.now();
		const added = await indexTranscript(db, "prefix", file);
		const buildMs = performance.now() - started;
		const indexBytes = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]
			.filter(existsSync)
			.reduce((sum, path) => sum + statSync(path).size, 0);
		return {
			buildMs,
			indexBytes,
			added,
			search: async (inputFile, query, { fields = "all", limit = 5 } = {}) => {
				if (inputFile !== file) throw new Error("Index belongs to another prefix");
				const hits = searchIndex(db, { query, sessions: ["prefix"], fields, limit });
				return { ids: hits.map((hit) => hit.entry), hits, actualToolDisplay: false };
			},
			close: () => db.close(),
		};
	} catch (error) {
		db.close();
		throw error;
	}
}

export function scoreIds(ids, question, supplementalLabels = []) {
	if (ids.length > 5 || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string"))
		throw new Error("Invalid ranked top-five identities");
	const labels = new Map();
	for (const label of [...question.episode.labels, ...(question.historical_top5 ?? []), ...supplementalLabels]) {
		if (labels.has(label.entry_id) && labels.get(label.entry_id) !== label.relevant)
			throw new Error("Conflicting frozen relevance judgments");
		labels.set(label.entry_id, label.relevant);
	}
	const relevant = new Set(question.complete_episode_relevant_ids);
	const labeledRelevant = new Set(
		question.episode.labels.filter((label) => label.relevant).map((label) => label.entry_id),
	);
	if (relevant.size !== labeledRelevant.size || [...relevant].some((id) => !labeledRelevant.has(id)))
		throw new Error("Inconsistent episode gold");
	return {
		returnedAt5: ids.length,
		knownRelevantAt5: ids.filter((id) => labels.get(id) === true).length,
		unjudgedAt5: ids.filter((id) => !labels.has(id)).length,
		episodeRelevantAt5: ids.filter((id) => relevant.has(id)).length,
		episodeGold: relevant.size,
	};
}

export function sourceIdentity(sourceRoot, directory) {
	const files = readdirSync(join(sourceRoot, directory))
		.filter((name) => name.endsWith(".ts"))
		.sort();
	return {
		revision: execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
		files: Object.fromEntries(files.map((file) => [file, sha256(readFileSync(join(sourceRoot, directory, file)))])),
	};
}

export async function replay({
	goldPath,
	output,
	label,
	sourceRoot,
	baselineRoot,
	engine = "current",
	fields = "all",
	repeats = 0,
	judgmentsPath,
}) {
	if (!/^[a-z0-9-]+$/.test(label) || !["current", "hybrid"].includes(engine) || !["all", "words"].includes(fields))
		throw new Error("Invalid replay options");
	const goldBytes = readFileSync(goldPath);
	const gold = JSON.parse(goldBytes);
	const judgmentsBytes = judgmentsPath ? readFileSync(judgmentsPath) : undefined;
	const judgments = judgmentsBytes ? JSON.parse(judgmentsBytes) : undefined;
	mkdirSync(output, { recursive: true, mode: 0o700 });
	const scratch = mkdtempSync(join(output, "prefixes-"));
	const baselineIdentity = sourceIdentity(baselineRoot, "components/session-search/src");
	const candidateIdentity =
		engine === "hybrid" ? sourceIdentity(sourceRoot, "components/session-state/src") : undefined;
	const currentSearch = await currentEngine(baselineRoot);
	const rows = [];
	const privateRows = [];
	try {
		for (const [offset, question] of gold.questions.entries()) {
			const prepared = historicalPrefix(question);
			const file = join(scratch, `${offset}.jsonl`);
			writeFileSync(file, prepared.text, { mode: 0o600 });
			const projection = eligibleProjection(prepared.prefix, prepared.branch, question);
			const projectedText = `${projection.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
			const projectedFile = join(scratch, `${offset}-eligible.jsonl`);
			writeFileSync(projectedFile, projectedText, { mode: 0o600 });
			const route = engine === "hybrid" && !isRegex(question.params.query) ? "index" : "current";
			let indexed;
			try {
				if (route === "index") {
					const dbDir = join(scratch, `${offset}-db`);
					mkdirSync(dbDir);
					indexed = await indexEngine(sourceRoot, projectedFile, dbDir);
				}
				const searchFile = indexed ? projectedFile : file;
				const search = indexed?.search ?? currentSearch;
				const options = { question, ...prepared, limit: 5, fields };
				const started = performance.now();
				const result = await search(searchFile, question.params.query, options);
				const firstMs = performance.now() - started;
				for (const id of result.ids) {
					if (!projection.some((entry) => entry.id === id)) throw new Error("Returned source outside eligible corpus");
				}
				const samples = [];
				for (let repeat = 0; repeat < repeats; repeat++) {
					const start = performance.now();
					const repeated = await search(searchFile, question.params.query, options);
					samples.push(performance.now() - start);
					if (JSON.stringify(repeated) !== JSON.stringify(result)) throw new Error("Repeated search changed output");
				}
				const sorted = [...samples].sort((a, b) => a - b);
				rows.push({
					id: question.id,
					route,
					fields,
					...scoreIds(
						result.ids,
						question,
						(judgments?.newLabels ?? [])
							.filter((row) => row.question === question.id)
							.map((row) => ({ entry_id: row.entryId, relevant: row.relevant })),
					),
					prefixBytes: Buffer.byteLength(prepared.text),
					prefixSha256: sha256(prepared.text),
					eligibleEntries: projection.filter((entry) => entry.type !== "session").length,
					projectionSha256: sha256(projectedText),
					firstMs,
					warmSamplesMs: samples,
					warmP95Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
					buildMs: indexed?.buildMs ?? null,
					indexBytes: indexed?.indexBytes ?? null,
					indexedEntries: indexed?.added ?? null,
					actualToolDisplay: result.actualToolDisplay,
					displaySufficient: null,
				});
				privateRows.push({ id: question.id, params: question.params, ...result });
			} finally {
				indexed?.close();
			}
		}
		if (
			JSON.stringify(sourceIdentity(baselineRoot, "components/session-search/src")) !==
				JSON.stringify(baselineIdentity) ||
			(engine === "hybrid" &&
				JSON.stringify(sourceIdentity(sourceRoot, "components/session-state/src")) !==
					JSON.stringify(candidateIdentity))
		)
			throw new Error("Measured source changed during replay");
		const report = {
			engine,
			fields,
			goldSha256: sha256(goldBytes),
			judgmentsSha256: judgmentsBytes ? sha256(judgmentsBytes) : null,
			harnessSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
			baselineIdentity,
			candidateIdentity,
			rows,
		};
		writeFileSync(join(output, `${label}-private.json`), JSON.stringify(privateRows, null, 2), { mode: 0o600 });
		writeFileSync(join(output, `${label}-aggregate.json`), JSON.stringify(report, null, 2), { mode: 0o600 });
		return report;
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [
		goldPath,
		output,
		label,
		baselineRoot,
		engine = "current",
		sourceRoot = baselineRoot,
		repeats = "0",
		judgmentsPath,
	] = process.argv.slice(2);
	if (!goldPath || !output || !label || !baselineRoot || !Number.isInteger(Number(repeats)) || Number(repeats) < 0)
		throw new Error(
			"Pass PRIVATE_GOLD PRIVATE_OUTPUT LABEL BASELINE_ROOT [current|hybrid] [CANDIDATE_ROOT] [REPEATS] [PRIVATE_JUDGMENTS]",
		);
	let root = dirname(fileURLToPath(import.meta.url));
	while (!existsSync(join(root, "package.json"))) root = dirname(root);
	if (resolve(output) === root || resolve(output).startsWith(`${root}/`))
		throw new Error("Keep private output outside the repository");
	const report = await replay({
		goldPath,
		output,
		label,
		baselineRoot,
		engine,
		sourceRoot,
		repeats: Number(repeats),
		judgmentsPath,
	});
	console.log(JSON.stringify(report.rows, null, 2));
}

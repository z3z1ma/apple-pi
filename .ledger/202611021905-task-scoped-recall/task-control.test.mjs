import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { sha256 } from "./engine-replay.mjs";
import { currentTaskControl } from "./task-control.mjs";

const timestamp = "2026-01-01T00:00:00.000Z";
const digest = (records) => sha256(`${records.map((entry) => JSON.stringify(entry)).join("\n")}\n`);

await test("task control recovers cross-person evidence with composite identity and original per-person ordinals", async () => {
	const dir = mkdtempSync(join(tmpdir(), "task-recall-control-"));
	try {
		const corpus = [];
		const labels = [];
		for (const session of ["one", "two"]) {
			const records = [
				{ type: "session", id: session, timestamp },
				{
					type: "message",
					id: "old",
					parentId: null,
					timestamp,
					message: { role: "user", content: "zircon outside selected task" },
				},
				{
					type: "message",
					id: "evidence",
					parentId: "old",
					timestamp,
					message: { role: "user", content: `zircon support from ${session}` },
				},
				{
					type: "message",
					id: "future",
					parentId: "evidence",
					timestamp,
					message: { role: "user", content: "zircon future" },
				},
			];
			const file = join(dir, `${session}.jsonl`);
			writeFileSync(file, `${records.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
			corpus.push({
				session_id: session,
				session_path: file,
				prefix_cutoff_line_1based: 3,
				prefix_cutoff_entry_id: "evidence",
				prefix_cutoff_at: timestamp,
				normalized_prefix_sha256: digest(records.slice(0, 3)),
				eligible_spans: [
					{
						task_id: "selected",
						from_line: 3,
						to_line: 3,
						from_entry: "evidence",
						to_entry: "evidence",
						normalized_records_sha256: digest([records[2]]),
					},
				],
			});
			labels.push({
				session_id: session,
				entry_id: "evidence",
				relevant: true,
				record_sha256: sha256(JSON.stringify(records[2])),
			});
		}
		const question = {
			id: "T",
			cutoff_at: timestamp,
			tool_call_id: null,
			params: { query: "zircon" },
			retrieval: { tasks: ["selected"] },
			corpus,
			episode: { labels },
		};
		const sourceRoot = resolve(process.env.RECALL_BASELINE_ROOT ?? ".");
		const result = await currentTaskControl(question, sourceRoot, dir);
		assert.deepEqual(new Set(result.addresses), new Set(["one:evidence", "two:evidence"]));
		assert.deepEqual(
			result.sources.map((source) => source.index),
			[1, 1],
		);
		assert.match(result.text, /support from one/);
		assert.match(result.text, /support from two/);
		assert.doesNotMatch(result.text, /outside selected task|zircon future/);
		assert.equal(result.actualExistingTool, false);
		for (const source of corpus) assert.match(readFileSync(source.session_path, "utf8"), /zircon future/);
		question.retrieval.tasks = ["another"];
		await assert.rejects(currentTaskControl(question, sourceRoot, dir), /outside declared tasks/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

await test("filtered FTS ranking still depends on rows outside the eligible person", () => {
	const db = new DatabaseSync(":memory:");
	try {
		db.exec("create virtual table docs using fts5(words, person unindexed)");
		const put = db.prepare("insert into docs(words, person) values (?, ?)");
		put.run("amber", "A");
		put.run("zircon", "A");
		const query = () =>
			db
				.prepare("select words from docs where docs match ? and person = ? order by bm25(docs), rowid")
				.all("amber OR zircon", "A")
				.map((row) => row.words);
		assert.deepEqual(query(), ["amber", "zircon"]);
		for (let i = 0; i < 20; i++) put.run("amber", "B");
		assert.deepEqual(query(), ["zircon", "amber"]);
		assert.equal(db.prepare("select count(*) as n from docs where person = 'A'").get().n, 2);
	} finally {
		db.close();
	}
});

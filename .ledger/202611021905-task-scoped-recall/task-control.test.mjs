import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const timestamp = "2026-01-01T00:00:00.000Z";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const serialize = (records) => `${records.map((entry) => JSON.stringify(entry)).join("\n")}\n`;

function withFixture(check) {
	const dir = mkdtempSync("/tmp/task-recall-control-");
	try {
		const corpus = [];
		const labels = [];
		const originals = new Map();
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
			const original = serialize(records);
			writeFileSync(file, original);
			originals.set(file, original);
			corpus.push({
				session_id: session,
				session_path: file,
				prefix_cutoff_line_1based: 3,
				prefix_cutoff_entry_id: "evidence",
				prefix_cutoff_at: timestamp,
				normalized_prefix_sha256: sha256(serialize(records.slice(0, 3))),
				eligible_spans: [
					{
						task_id: "selected",
						from_line: 3,
						to_line: 3,
						from_entry: "evidence",
						to_entry: "evidence",
						normalized_records_sha256: sha256(serialize([records[2]])),
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
		const goldPath = join(dir, "gold.json");
		const output = join(dir, "report.json");
		const sourceRoot = resolve(process.env.RECALL_BASELINE_ROOT ?? ".");
		const run = () => {
			writeFileSync(goldPath, JSON.stringify({ questions: [question] }));
			return spawnSync(
				process.execPath,
				[
					"--import",
					join(sourceRoot, "components/session-state/src/register.mjs"),
					fileURLToPath(new URL("./task-control.mjs", import.meta.url)),
					goldPath,
					output,
					sourceRoot,
				],
				{ encoding: "utf8", timeout: 30000 },
			);
		};
		check({ question, originals, output, run });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

await test("CLI reports both people's selected evidence with original ordinals and leaves source transcripts unchanged", () => {
	withFixture(({ originals, output, run }) => {
		const process = run();
		assert.equal(process.status, 0, process.stderr);
		const report = JSON.parse(readFileSync(output, "utf8"));
		const result = report.results[0];
		assert.deepEqual(new Set(result.addresses), new Set(["one:evidence", "two:evidence"]));
		assert.deepEqual(
			result.sources
				.map((source) => ({ session: source.session, entry: source.entry, index: source.index }))
				.sort((a, b) => a.session.localeCompare(b.session)),
			[
				{ session: "one", entry: "evidence", index: 1 },
				{ session: "two", entry: "evidence", index: 1 },
			],
		);
		assert.match(result.text, /support from one/);
		assert.match(result.text, /support from two/);
		assert.doesNotMatch(result.text, /outside selected task|zircon future/);
		for (const [file, original] of originals) assert.equal(readFileSync(file, "utf8"), original);
	});
});

await test("CLI rejects corpus intervals outside the declared task set rather than emitting a comparison", () => {
	withFixture(({ question, output, run }) => {
		question.retrieval.tasks = ["another"];
		const process = run();
		assert.notEqual(process.status, 0);
		assert.match(process.stderr, /outside declared tasks/);
		assert.equal(existsSync(output), false);
	});
});

await test("CLI rejects changed frozen evidence rather than reporting results for a different corpus", () => {
	withFixture(({ originals, output, run }) => {
		const [file, original] = originals.entries().next().value;
		writeFileSync(file, original.replace("zircon support", "changed support"));
		const process = run();
		assert.notEqual(process.status, 0);
		assert.match(process.stderr, /Task source prefix changed/);
		assert.equal(existsSync(output), false);
	});
});

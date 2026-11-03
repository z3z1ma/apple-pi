import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sha256 } from "./engine-replay.mjs";
import { actualReplay } from "./tool-replay.mjs";

const sourceRoot = process.env.RECALL_TOOL_ROOT;
const at = (n) => new Date(Date.UTC(2026, 10, 2) + n * 1000).toISOString();
const message = (id, parentId, n, role, content) => ({
	type: "message",
	id,
	parentId,
	timestamp: at(n),
	message: { role, content },
});
const header = (id) => ({ type: "session", version: 3, id, timestamp: at(0), cwd: "/tmp" });
const text = (records) => `${records.map((entry) => JSON.stringify(entry)).join("\n")}\n`;

async function runFixture(makeGold, check) {
	const dir = mkdtempSync("/tmp/kofi-tool-public-");
	try {
		const gold = makeGold(dir);
		const goldPath = join(dir, "gold.json");
		const output = join(dir, "output.json");
		writeFileSync(goldPath, JSON.stringify(gold), { mode: 0o600 });
		const aggregate = await actualReplay({ goldPath, output, sourceRoot });
		assert.equal(aggregate.violations, 0);
		check(JSON.parse(readFileSync(output)));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test("actual tool excludes indexed off-branch and issuer records, preserving source ordinal and body", {
	skip: !sourceRoot,
}, async () => {
	await runFixture(
		(dir) => {
			const records = [
				header("caller"),
				message("start", null, 1, "user", "Begin"),
				message("answer", "start", 2, "assistant", "The archive log has the original decision."),
				message("off", "start", 3, "assistant", "archive log ".repeat(30)),
				message("issuer", "answer", 4, "assistant", [
					{ type: "toolCall", id: "call_1", name: "search_session", arguments: { query: "archive log" } },
				]),
			];
			const file = join(dir, "caller.jsonl");
			writeFileSync(file, text(records), { mode: 0o600 });
			return {
				questions: [
					{
						id: "public-personal",
						session_path: file,
						issuing_entry_id: "issuer",
						tool_call_id: "call_1",
						params: { query: "archive log" },
						episode: {
							labels: [{ entry_id: "answer", relevant: true, record_sha256: sha256(JSON.stringify(records[2])) }],
						},
					},
				],
			};
		},
		(out) => {
			assert.deepEqual(out.results[0].ids, ["answer"]);
			assert.equal(out.results[0].details.sources[0].index, 1);
			assert.match(out.results[0].text, /original decision/);
		},
	);
});

test("actual task words keep cross-person identities and span boundaries despite punctuation", {
	skip: !sourceRoot,
}, async () => {
	await runFixture(
		(dir) => {
			const corpus = ["caller", "remote"].map((session_id) => {
				const records = [
					header(session_id),
					message("start", null, 1, "user", "Begin"),
					message("answer", "start", 2, "assistant", `${session_id} retained the archive path.`),
					message("outside", "answer", 3, "assistant", "archive path ".repeat(30)),
					message("end", "outside", 4, "user", "Finish"),
				];
				const file = join(dir, `${session_id}.jsonl`);
				writeFileSync(file, text(records), { mode: 0o600 });
				return {
					session_id,
					person_name: session_id,
					session_path: file,
					prefix_cutoff_line_1based: records.length,
					prefix_cutoff_entry_id: "end",
					prefix_cutoff_at: at(4),
					normalized_prefix_sha256: sha256(text(records)),
					eligible_spans: [
						{
							task_id: "shared",
							from_line: 2,
							to_line: 3,
							from_entry: "start",
							to_entry: "answer",
							from_at: at(1),
							to_at: at(2),
							normalized_records_sha256: sha256(text(records.slice(1, 3))),
						},
					],
				};
			});
			return {
				questions: [
					{
						id: "public-task",
						session_id: "caller",
						corpus,
						cutoff_at: at(4),
						tool_call_id: null,
						params: { query: "archive.path?" },
						retrieval: { tasks: ["shared"] },
						episode: { labels: [] },
					},
				],
			};
		},
		(out) => {
			assert.deepEqual(out.results[0].addresses.sort(), ["caller:answer", "remote:answer"]);
			assert.match(out.results[0].text, /entry:remote\/answer/);
			assert.equal(out.results[0].toolError, false);
		},
	);
});

test("an obsolete background is rejected without migrating or erasing its source", { skip: !sourceRoot }, async () => {
	const dir = mkdtempSync("/tmp/kofi-tool-version-");
	try {
		const background = join(dir, "old.sqlite");
		const db = new DatabaseSync(background);
		db.exec(
			"pragma user_version=1; create table entries(words text); insert into entries values ('retained background')",
		);
		db.close();
		const originalHash = sha256(readFileSync(background));
		const file = join(dir, "caller.jsonl");
		writeFileSync(file, text([header("caller"), message("end", null, 1, "user", "Begin")]), { mode: 0o600 });
		const goldPath = join(dir, "gold.json");
		writeFileSync(
			goldPath,
			JSON.stringify({
				questions: [
					{
						id: "public-version",
						session_path: file,
						issuing_entry_id: "end",
						tool_call_id: "absent",
						params: { query: "archive" },
						episode: { labels: [] },
					},
				],
			}),
			{ mode: 0o600 },
		);
		await assert.rejects(
			actualReplay({ goldPath, output: join(dir, "output.json"), sourceRoot, background }),
			/must already have v2/,
		);
		assert.equal(sha256(readFileSync(background)), originalHash);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

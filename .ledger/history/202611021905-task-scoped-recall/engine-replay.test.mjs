import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { replay } from "./engine-replay.mjs";

const at = "2026-01-01T00:00:00.000Z";
const records = [
	{ type: "session", id: "session", timestamp: at },
	{
		type: "message",
		id: "ask",
		parentId: null,
		timestamp: at,
		message: { role: "user", content: "Historical zircon evidence" },
	},
	{
		type: "message",
		id: "answer",
		parentId: "ask",
		timestamp: at,
		message: { role: "assistant", content: [{ type: "text", text: "zircon evidence supports this answer" }] },
	},
	{
		type: "message",
		id: "fork",
		parentId: "ask",
		timestamp: at,
		message: { role: "user", content: "zircon off-branch" },
	},
	{
		type: "message",
		id: "issuer",
		parentId: "answer",
		timestamp: at,
		message: {
			role: "assistant",
			content: [{ type: "toolCall", id: "parent", name: "pi_exec", arguments: { query: "zircon" } }],
		},
	},
	{
		type: "message",
		id: "future",
		parentId: "issuer",
		timestamp: at,
		message: { role: "user", content: "zircon future" },
	},
];

async function withFixture(check) {
	const dir = mkdtempSync(join(tmpdir(), "recall-replay-test-"));
	try {
		const file = join(dir, "source.jsonl");
		const original = `${records.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
		writeFileSync(file, original);
		const goldPath = join(dir, "gold.json");
		const output = join(dir, "output");
		mkdirSync(output);
		const question = {
			id: "S1",
			session_path: file,
			issuing_entry_id: "issuer",
			tool_call_id: "parent/1/2",
			params: { query: "zircon", page: 1 },
			episode: {
				labels: [
					{ entry_id: "ask", relevant: false },
					{ entry_id: "answer", relevant: true },
				],
			},
			complete_episode_relevant_ids: ["answer"],
			historical_top5: [],
		};
		const sourceRoot = resolve(process.env.RECALL_BASELINE_ROOT ?? ".");
		const run = async (options = {}) => {
			writeFileSync(goldPath, JSON.stringify({ questions: [question] }));
			return replay({ goldPath, output, label: "control", baselineRoot: sourceRoot, sourceRoot, ...options });
		};
		const result = () => JSON.parse(readFileSync(join(output, "control-private.json")))[0];
		await check({ file, original, question, output, dir, run, result });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

await test("replay recovers historical evidence from the active prefix, excluding future, fork and nested issuer", async () => {
	await withFixture(async ({ file, original, output, run, result }) => {
		const report = await run();
		const raw = result();
		assert.deepEqual(new Set(raw.ids), new Set(["ask", "answer"]));
		assert.match(raw.text, /supports this answer/);
		assert.equal(report.rows[0].episodeRelevantAt5, 1);
		assert.equal(report.rows[0].knownRelevantAt5, 1);
		assert.equal(report.rows[0].actualToolDisplay, true);
		assert.equal(report.rows[0].displaySufficient, null);
		assert.equal(readFileSync(file, "utf8"), original);
		assert.deepEqual(readdirSync(output).sort(), ["control-aggregate.json", "control-private.json"]);
	});
});

await test("all-branch replay recovers off-lineage history without admitting future or issuing entries", async () => {
	await withFixture(async ({ question, run, result }) => {
		question.params.scope = "all";
		await run();
		assert.deepEqual(new Set(result().ids), new Set(["ask", "answer", "fork"]));
	});
});

await test("unjudged sources stay unknown until supplementary labels arrive, independently of episode recovery", async () => {
	await withFixture(async ({ question, dir, run }) => {
		question.episode.labels = [{ entry_id: "answer", relevant: true }];
		const before = await run();
		assert.equal(before.rows[0].returnedAt5, 2);
		assert.equal(before.rows[0].unjudgedAt5, 1);
		assert.equal(before.rows[0].knownRelevantAt5, 1);
		assert.equal(before.rows[0].episodeRelevantAt5, 1);
		const judgmentsPath = join(dir, "judgments.json");
		writeFileSync(judgmentsPath, JSON.stringify({ newLabels: [{ question: "S1", entryId: "ask", relevant: true }] }));
		const after = await run({ judgmentsPath });
		assert.equal(after.rows[0].unjudgedAt5, 0);
		assert.equal(after.rows[0].knownRelevantAt5, 2);
		assert.equal(after.rows[0].episodeRelevantAt5, 1);
		assert.equal(after.rows[0].episodeGold, 1);
	});
});

await test("replay rejects changed frozen evidence and removes temporary material on failure", async () => {
	await withFixture(async ({ file, question, output, run }) => {
		const prefix = `${records
			.slice(0, 5)
			.map((entry) => JSON.stringify(entry))
			.join("\n")}\n`;
		question.cutoff = { prefix_sha256: createHash("sha256").update(prefix).digest("hex") };
		writeFileSync(file, readFileSync(file, "utf8").replace("supports this answer", "changed evidence"));
		await assert.rejects(run(), /Frozen normalized prefix hash changed/);
		assert.deepEqual(readdirSync(output), []);
	});
});

await test("an unavailable source checkout fails without leaving temporary material", async () => {
	await withFixture(async ({ dir, output, run }) => {
		await assert.rejects(run({ baselineRoot: join(dir, "unavailable-checkout") }), { code: "ENOENT" });
		assert.deepEqual(readdirSync(output), []);
	});
});

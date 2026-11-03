import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { eligibleProjection, historicalPrefix, isRegex, replay, scoreIds, sha256 } from "./engine-replay.mjs";

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
const makeQuestion = (sessionPath) => ({
	id: "S1",
	session_path: sessionPath,
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
});

await test("prefix, branch and issuer projection preserve source identities", () => {
	const dir = mkdtempSync(join(tmpdir(), "recall-prefix-test-"));
	try {
		const file = join(dir, "source.jsonl");
		writeFileSync(file, `${records.map(JSON.stringify).join("\n")}\n`);
		const q = makeQuestion(file);
		const p = historicalPrefix(q);
		assert.deepEqual(
			p.prefix.map((entry) => entry.id),
			["session", "ask", "answer", "fork", "issuer"],
		);
		assert.deepEqual(
			p.branch.map((entry) => entry.id),
			["ask", "answer", "issuer"],
		);
		assert.deepEqual(
			eligibleProjection(p.prefix, p.branch, q).map((entry) => entry.id),
			["session", "ask", "answer"],
		);
		assert.deepEqual(
			eligibleProjection(p.prefix, p.branch, { ...q, params: { scope: "all" } }).map((entry) => entry.id),
			["session", "ask", "answer", "fork"],
		);
		q.cutoff = { prefix_sha256: sha256(p.text) };
		assert.equal(historicalPrefix(q).text, p.text);
		q.cutoff.prefix_sha256 = "changed";
		assert.throws(() => historicalPrefix(q), /prefix hash changed/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

await test("unknown relevance and episode membership are separate; invalid gold fails", () => {
	const q = makeQuestion("unused");
	assert.deepEqual(scoreIds(["answer", "novel"], q), {
		returnedAt5: 2,
		knownRelevantAt5: 1,
		unjudgedAt5: 1,
		episodeRelevantAt5: 1,
		episodeGold: 1,
	});
	assert.throws(() => scoreIds(["answer", "answer"], q), /Invalid ranked/);
	assert.throws(() => scoreIds([], { ...q, complete_episode_relevant_ids: [] }), /Inconsistent/);
	assert.throws(
		() => scoreIds([], { ...q, historical_top5: [{ entry_id: "answer", relevant: false }] }),
		/Conflicting/,
	);
	assert.equal(isRegex("zircon evidence"), false);
	assert.equal(isRegex("zircon|evidence"), true);
});

await test("actual baseline tool uses the prefix and metadata; scratch prefixes are removed", async () => {
	const dir = mkdtempSync(join(tmpdir(), "recall-engine-test-"));
	try {
		const file = join(dir, "source.jsonl");
		writeFileSync(file, `${records.map(JSON.stringify).join("\n")}\n`);
		const q = makeQuestion(file);
		const goldPath = join(dir, "gold.json");
		writeFileSync(goldPath, JSON.stringify({ questions: [q] }));
		const sourceRoot = resolve(process.env.RECALL_BASELINE_ROOT ?? ".");
		const result = await replay({
			goldPath,
			output: dir,
			label: "public-control",
			baselineRoot: sourceRoot,
			sourceRoot,
		});
		const raw = JSON.parse(readFileSync(join(dir, "public-control-private.json")));
		assert.equal(result.rows[0].episodeRelevantAt5, 1);
		assert.equal(result.rows[0].actualToolDisplay, true);
		assert.equal(result.rows[0].displaySufficient, null);
		assert.deepEqual(new Set(raw[0].ids), new Set(["ask", "answer"]));
		assert.match(raw[0].text, /supports this answer/);
		assert.equal(
			readdirSync(dir).some((name) => name.startsWith("prefixes-")),
			false,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

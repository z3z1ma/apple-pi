import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, expect, test } from "vitest";
import { statePaths } from "../../session-state/src/paths.js";
import { migrate } from "../../session-state/src/schema.js";
import { indexTranscript, openIndex } from "../../session-state/src/transcript-index.hot.js";
import { startRuntime, stopRuntime, tempStateDir } from "../../session-state/tests/helpers.js";
import type { RecallRecord } from "../src/indexed-recall.js";
import { sessionSearchTool } from "../src/tool.js";
import { assistantText, assistantWithToolCall, toolResult, userMsg } from "./fixtures.js";

const state = tempStateDir();
const at = Date.parse("2026-10-30T12:00:00Z");
const entry = (
	id: string,
	order: number,
	body: Record<string, unknown>,
	parentId: string | null = "question",
): RecallRecord => ({
	type: "message",
	id,
	parentId,
	timestamp: new Date(at + order * 1000).toISOString(),
	...body,
});
const records: RecallRecord[] = [
	entry("question", 0, { message: userMsg("What caused cobalt?") }, null),
	entry("off", 1, { message: assistantText("cobalt cobalt cobalt cobalt cobalt cobalt") }),
	entry("answer", 2, { message: assistantText("Cobalt was fixed by keeping the source identity.") }),
	entry("opaque", 3, { message: { role: "extension-role", content: "not indexed" } }),
	entry("mail", 4, { type: "custom_message", customType: "mail", content: "cobalt mail: keep the receipt evidence" }),
	entry("summary", 5, { type: "compaction", summary: "cobalt summary: the native path matters" }),
	entry("notebook", 6, {
		type: "custom",
		customType: "notebook.reflections.recorded",
		data: { reflections: [{ id: "note1", content: "cobalt notebook evidence", sourceEntryIds: ["answer"] }] },
	}),
	entry("bash", 7, { message: { role: "bashExecution", command: "echo ignored", output: "" } }),
	...Array.from({ length: 6 }, (_, i) =>
		entry(`extra-${i}`, 8 + i, {
			message: assistantText(`cobalt evidence ${i}: inspect this longer source before making a claim.`),
		}),
	),
	entry("extension", 15, { type: "custom", customType: "extension.audit", data: { decision: "quartz custom record" } }),
	entry("written", 16, {
		message: assistantWithToolCall("write", { path: "fixture.ts", content: "legacy file payload" }),
	}),
	entry("result", 17, { message: toolResult("write", "legacy tool result") }, "written"),
	entry("stem", 18, { message: assistantText("We repaired the ordering.") }),
	entry("issuer", 19, {
		message: {
			...assistantWithToolCall("search_session", { query: "cobalt cobalt cobalt cobalt cobalt cobalt" }),
			content: [
				{
					type: "toolCall",
					id: "discover",
					name: "search_session",
					arguments: { query: "cobalt cobalt cobalt cobalt cobalt cobalt cobalt cobalt" },
				},
			],
		},
	}),
];
const remote = [
	entry("outside", 30, { message: assistantText("cobalt cobalt cobalt cobalt cobalt cobalt") }, null),
	entry("answer", 31, { message: assistantText("cobalt remote source: Avery verified the correction") }, null),
	entry(
		"detail",
		31.5,
		{
			message: assistantWithToolCall("edit", {
				path: "remote.ts",
				edits: [{ oldText: "old", newText: "REMOTE_SOURCE_END" }],
			}),
		},
		null,
	),
];
const file = join(state.agentDir, "caller.jsonl");
const remoteFile = join(state.agentDir, "remote.jsonl");
const active = records.filter((record) => record.id !== "off");
const context = (caller = "caller", branch = active, all = records) =>
	({
		sessionManager: {
			getSessionId: () => caller,
			getSessionFile: () => file,
			getBranch: () => branch,
			getEntries: () => all,
		},
	}) as any;
const run = async (params: Parameters<typeof sessionSearchTool.execute>[1], ctx = context(), id = "discover/0") => {
	const result = await sessionSearchTool.execute(id, params, undefined, undefined, ctx);
	return {
		text: result.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n"),
		sources: (result.details as any)?.sources ?? [],
	};
};

beforeAll(async () => {
	mkdirSync(state.stateDir, { recursive: true });
	for (const [id, path, entries] of [
		["caller", file, records],
		["remote", remoteFile, remote],
	] as const) {
		const transcript = [
			{ type: "session", version: 3, id, timestamp: new Date(at).toISOString(), cwd: state.agentDir },
			...entries,
		]
			.map((value) => JSON.stringify(value))
			.join("\n");
		writeFileSync(path, `${transcript}\n`);
	}
	// Seed an isolated stopped runtime's database; the daemon is its only writer after start.
	const db = new DatabaseSync(state.dbPath);
	migrate(db);
	const person = db.prepare(
		"insert into sessions (id, name, kind, cwd, run_state, generation, source, updated_at, session_file) values (?, ?, 'root', ?, 'idle', 1, 'test', ?, ?)",
	);
	person.run("caller", "Caller Fixture", state.agentDir, at, file);
	person.run("remote", "Avery Fixture", state.agentDir, at, remoteFile);
	const row = db.prepare(
		"insert into messages (session_id, entry_id, part, at, role, size, preview, source) values (?, ?, '', ?, 'user', 1, '', 'test')",
	);
	for (const [session, entries] of [
		["caller", records],
		["remote", remote],
	] as const)
		for (const source of entries) row.run(session, source.id, Date.parse(source.timestamp!));
	const span = db.prepare(
		"insert into focus_spans(person, task_id, started_at, ended_at, reconstructed) values (?, ?, ?, ?, 0)",
	);
	span.run("caller", "shared-task", at, at + 100_000);
	span.run("remote", "shared-task", at + 31_000, at + 32_000);
	span.run("remote", "private-task", at + 30_000, at + 31_000);
	db.close();
	const index = openIndex(statePaths().transcriptIndex);
	await indexTranscript(index, "caller", file);
	await indexTranscript(index, "remote", remoteFile);
	index.close();
	await startRuntime(state.socketPath);
}, 30_000);
afterAll(() => stopRuntime(state));

test("NL routing excludes off-lineage and native-call issuer entries before the five-hit page is selected", async () => {
	const control = await run({ query: "cobalt", scope: "all" }, context(), "another-search");
	const first = control.sources.slice(0, 2).map((source: any) => source.entryId);
	expect(first).toContain("off");
	expect(first).toContain("issuer");
	const answer = await run({ query: "cobalt" });
	expect(answer.sources).toHaveLength(5);
	expect(answer.sources.map((source: any) => source.entryId)).not.toContain("off");
	expect(answer.sources.map((source: any) => source.entryId)).not.toContain("issuer");
	expect(answer.text).toContain("Page 1/3 (11 total matches)");
	expect(answer.text).toContain("Read source: entry:");
	expect(answer.text).toContain("Use page:2");
	const all = await run({ query: "cobalt", scope: "all" });
	expect(all.sources.map((source: any) => source.entryId)).toContain("off");
	expect(all.sources.map((source: any) => source.entryId)).not.toContain("issuer");
});

test("indexed message addresses recover the same sources across skipped, custom and off-branch records", async () => {
	const messageIds = records.filter((record) => record.type === "message" && record.message).map((record) => record.id);
	const sources: any[] = [];
	for (const page of [1, 2, 3]) {
		const found = await run({ query: "cobalt", page });
		sources.push(...found.sources);
		for (const source of found.sources) {
			const ordinal = messageIds.indexOf(source.entryId);
			expect(source.index).toBe(ordinal < 0 ? undefined : ordinal);
			if (ordinal >= 0) {
				const recovered = await run({ expand: [ordinal] });
				expect(recovered.text).toContain(`Source: entry:${source.entryId}`);
			} else expect(found.text).toContain(`Read source: entry:${source.entryId}`);
		}
	}
	expect(sources.map((source) => source.entryId)).toEqual(
		expect.arrayContaining(["answer", "extra-5", "mail", "summary", "notebook"]),
	);
	const answer = await run({ query: "source identity" });
	expect(answer.text).toContain("#2 [assistant]");
	expect(answer.text).toContain("preceding input entry:question");
});

test("indexed NL pages preserve match counts and advance without repeating a ranked source", async () => {
	const first = await run({ query: "cobalt" });
	const second = await run({ query: "cobalt", page: 2 });
	expect(second.text).toContain("Page 2/3 (11 total matches)");
	expect(second.sources).toHaveLength(5);
	expect(
		second.sources.every((source: any) => !first.sources.some((prior: any) => prior.entryId === source.entryId)),
	).toBe(true);
	const tooFar = await run({ query: "cobalt", page: 4 });
	expect(tooFar.text).toContain("Too many results to page through");
});

test("words omits tool payloads while all and its default recover them", async () => {
	const words = await run({ query: "legacy", fields: "words" });
	expect(words.sources).toEqual([]);
	for (const fields of ["all", undefined] as const) {
		const all = await run({ query: "legacy", fields });
		expect(all.sources.map((source: any) => source.entryId)).toEqual(expect.arrayContaining(["written", "result"]));
		expect(all.text).toContain("legacy file payload");
	}
});

test("authorized task search spans people, keeps equal entry IDs distinct and attributes qualified sources", async () => {
	const answer = await run({ query: "identity verified", tasks: ["shared-task"] });
	expect(answer.sources.map((source: any) => `${source.session}/${source.entryId}`).sort()).toEqual([
		"caller/answer",
		"remote/answer",
	]);
	const scoped = await run({ query: "cobalt", tasks: ["shared-task"] });
	expect(scoped.sources.some((source: any) => source.session === "remote" && source.entryId === "outside")).toBe(false);
	const remote = answer.sources.find((source: any) => source.session === "remote");
	expect(remote).toMatchObject({ entryId: "answer", name: "Avery Fixture", task: "shared-task" });
	expect(answer.text).toContain("Transcript: Avery Fixture (remote)");
	expect(answer.text).toContain("Written while focused on task: shared-task");
	expect(answer.text).toContain("Read source: entry:remote/answer");
	expect(answer.text).toContain("keeping the source identity");
	expect(answer.text).toContain("Avery verified the correction");
	const detail = await run({ query: "entry:remote/answer" });
	expect(detail.text).toContain("Avery verified the correction");
	expect(detail.text).toContain("entry:remote/answer [message]");
});

test("qualified source recovery retains full tool arguments and line continuation", async () => {
	const first = await run({ query: "entry:remote/detail:0:2" });
	expect(first.text).toContain("Continue with entry:remote/detail:2:2");
	expect(first.text).not.toContain("REMOTE_SOURCE_END");
	const next = await run({ query: "entry:remote/detail:2:2000" });
	expect(next.text).toContain("REMOTE_SOURCE_END");
	expect(next.text).toContain("oldText");
});

test("task and cross-person source refusals come from runtime policy rather than personal fallback", async () => {
	const refused = await run({ query: "cobalt", tasks: ["private-task"] });
	expect(refused.text).toContain("Only people assigned to a task");
	expect(refused.sources).toEqual([]);
	const denied = await run({ query: "entry:remote/outside" });
	expect(denied.text).toContain("outside every task you may search");
	expect(denied.text).not.toContain("cobalt cobalt");
});

test("qualified own-source recovery keeps the selected lineage boundary", async () => {
	expect((await run({ query: "entry:caller/off" })).text).toContain("not available in the requested scope");
	expect((await run({ query: "entry:caller/off", scope: "all" })).text).toContain("cobalt cobalt");
});

test("stemmed index matches keep evidence labels from the rendered source", async () => {
	const answer = await run({ query: "repairing" });
	expect(answer.text).toContain("Read source: entry:stem");
	expect(answer.text).toContain("[assistant text]");
	expect(answer.text).toContain("We repaired the ordering.");
});

test("state-only extension data remains outside discovery and source rendering", async () => {
	const found = await run({ query: "quartz" });
	expect(found.text).toContain("No matches");
	const recovered = await run({ query: "entry:caller/extension" });
	expect(recovered.text).toContain("Cannot read qualified transcript source");
	expect(recovered.text).not.toContain("quartz custom record");
});

test("personal regex, source, payload, touched and expansion recovery work without the index runtime", async () => {
	const previous = process.env.PI_CODING_AGENT_DIR;
	try {
		process.env.PI_CODING_AGENT_DIR = join(state.agentDir, "missing-runtime");
		for (const [params, evidence] of [
			[{ query: "payload|result" }, "Read source: entry:written"],
			[{ query: "entry:answer" }, "Cobalt was fixed by keeping the source identity."],
			[{ query: "call:tc_1" }, "legacy tool result"],
			[{ query: "legacy", mode: "file" }, "legacy file payload"],
			[{ mode: "touched" }, "fixture.ts"],
			[{ expand: [2] }, "Source: entry:answer"],
			[{ query: "#11:fixture.ts" }, "legacy file payload"],
		] as const) {
			const result = await run(params);
			expect(result.text, JSON.stringify(params)).toContain(evidence);
		}
	} finally {
		process.env.PI_CODING_AGENT_DIR = previous;
	}
});

test("task queries treat punctuation as word separators rather than personal regex syntax", async () => {
	const result = await run({ query: "verified (ordering)", tasks: ["shared-task"] });
	expect(result.sources.map((source: any) => `${source.session}/${source.entryId}`)).toEqual(
		expect.arrayContaining(["caller/stem", "remote/answer"]),
	);
	expect(result.text).toContain("Avery verified the correction");
});

test("indexed queries use the legacy meaningful terms but display the original question", async () => {
	const query = "what was it about verified";
	const result = await run({ query, tasks: ["shared-task"] });
	expect(result.sources.map((source: any) => `${source.session}/${source.entryId}`)).toEqual(["remote/answer"]);
	expect(result.text).toContain(query);
	const onlyStopwords = await run({ query: "what was", fields: "words" });
	expect(onlyStopwords.sources.map((source: any) => source.entryId).sort()).toEqual(["answer", "question"]);
});

test("task search refuses file, touched and expansion modes rather than dropping the task scope", async () => {
	for (const params of [{ mode: "file" }, { mode: "touched" }, { expand: [2] }] as const) {
		const result = await run({ query: "cobalt", tasks: ["shared-task"], ...params });
		expect(result.text).toContain("Task search matches words through the index");
		expect(result.sources).toEqual([]);
	}
});

test("an already cancelled indexed request reports cancellation", async () => {
	const controller = new AbortController();
	controller.abort(new Error("recall cancelled by test"));
	await expect(
		sessionSearchTool.execute("discover/0", { query: "cobalt" }, controller.signal, undefined, context()),
	).rejects.toThrow("recall cancelled by test");
});

test("a missing socket is explicit and never falls back to a successful personal result", async () => {
	const previous = process.env.PI_CODING_AGENT_DIR;
	try {
		process.env.PI_CODING_AGENT_DIR = join(state.agentDir, "missing-runtime");
		await expect(run({ query: "cobalt" })).rejects.toThrow("No personal-engine fallback was used");
	} finally {
		process.env.PI_CODING_AGENT_DIR = previous;
	}
});

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { replayRule } from "../src/replay.js";

const base = mkdtempSync(join(tmpdir(), "repo-rules-replay-"));
const root = join(base, "repo");
const sessionsDir = join(base, "sessions");
const since = Date.parse("2026-11-04T00:00:00Z");
const consoleRule = "language js\n\n`console.log($x)`";

function call(name: string, args: Record<string, unknown>) {
	return { type: "toolCall", id: `call-${name}`, name, arguments: args };
}

function session(file: string, id: string, cwd: string, entries: [string, string, ReturnType<typeof call>[]][]) {
	const lines = [
		{ type: "session", version: 3, id, timestamp: "2026-11-01T00:00:00Z", cwd },
		...entries.map(([entry, timestamp, calls]) => ({
			type: "message",
			id: entry,
			timestamp,
			message: { role: "assistant", content: calls },
		})),
	];
	const path = join(sessionsDir, file);
	writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
	return path;
}

beforeAll(() => {
	mkdirSync(root, { recursive: true });
	mkdirSync(sessionsDir, { recursive: true });
	session("here.jsonl", "here", root, [
		["old", "2026-11-03T12:00:00Z", [call("write", { path: "src/old.js", content: "console.log(1);\n" })]],
		[
			"batch",
			"2026-11-05T10:00:00Z",
			[
				call("write", { path: "src/a.js", content: "const a = 1;\nconsole.log(a);\n" }),
				call("edit", { path: join(root, "src/b.js"), edits: [{ oldText: "x", newText: "console.log(b);" }] }),
				call("edit", { path: "docs/notes.md", edits: [{ oldText: "x", newText: "console.log(c);" }] }),
				call("bash", { command: "git push origin main" }),
				call("bash", { command: "git status" }),
			],
		],
		["clean", "2026-11-05T11:00:00Z", [call("write", { path: "src/c.js", content: "export const c = 1;\n" })]],
	]);
	session("elsewhere.jsonl", "elsewhere", join(base, "other"), [
		["far", "2026-11-05T10:00:00Z", [call("write", { path: "src/a.js", content: "console.log(far);\n" })]],
	]);
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

test("a code rule is replayed on the text recorded edits and writes added in this repository since the window start", async () => {
	const report = await replayRule({ grit: consoleRule, includes: ["src/**"] }, { root, since, sessionsDir });
	const file = join(sessionsDir, "here.jsonl");
	expect(report.hits).toEqual([
		{ at: "2026-11-05T10:00:00Z", ref: "entry:here/batch", file, path: "src/a.js", lines: [2] },
		{ at: "2026-11-05T10:00:00Z", ref: "entry:here/batch", file, path: "src/b.js", lines: [1] },
	]);
	expect(report.evaluated).toBe(3);
	expect(report.sessions).toBe(1);
	expect(report.notEvaluated).toEqual([]);
});

test("an action rule's pattern is replayed on recorded shell commands", async () => {
	const report = await replayRule({ pattern: "\\bgit\\s+push\\b" }, { root, since, sessionsDir });
	expect(report.hits).toEqual([
		{
			at: "2026-11-05T10:00:00Z",
			ref: "entry:here/batch",
			file: join(sessionsDir, "here.jsonl"),
			command: "git push origin main",
		},
	]);
	expect(report.evaluated).toBe(2);
});

test("text the rule cannot evaluate is listed as not evaluated, never as allowed", async () => {
	const report = await replayRule({ grit: "language js\n\n`console.log(" }, { root, since, sessionsDir });
	expect(report.hits).toEqual([]);
	expect(report.evaluated).toBe(0);
	expect(report.notEvaluated.length).toBe(4);
});

test("every edit shape the edit tool accepts is replayed once, through path aliases and forked copies, in time order", async () => {
	const dir = mkdtempSync(join(tmpdir(), "repo-rules-shapes-"));
	const repo = join(dir, "repo");
	const alias = join(dir, "alias");
	const logs = join(dir, "sessions");
	mkdirSync(repo, { recursive: true });
	mkdirSync(logs);
	symlinkSync(repo, alias);
	const write = (file: string, id: string, cwd: string, entries: [string, string, ReturnType<typeof call>[]][]) => {
		const lines = [
			{ type: "session", version: 3, id, timestamp: "2026-11-01T00:00:00Z", cwd },
			...entries.map(([entry, timestamp, calls]) => ({
				type: "message",
				id: entry,
				timestamp,
				message: { role: "assistant", content: calls },
			})),
		];
		writeFileSync(join(logs, file), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
	};
	const shapes: [string, string, ReturnType<typeof call>[]][] = [
		[
			"late",
			"2026-11-05T12:30:00+02:00",
			[call("edit", { path: "@src/late.js", oldText: "x", newText: "console.log(4);" })],
		],
		[
			"string",
			"2026-11-05T09:00:00Z",
			[call("edit", { path: "src/s.js", edits: '[{"oldText":"x","newText":"console.log(1);"}]' })],
		],
		[
			"single",
			"2026-11-05T09:10:00Z",
			[call("edit", { path: "src/o.js", edits: { oldText: "x", newText: "console.log(2);" } })],
		],
		[
			"final",
			"2026-11-05T11:00:00Z",
			[call("edit", { path: "src/f.js", edits: [{ oldText: "x", newText: "console.log(3);" }] })],
		],
	];
	write("via-alias.jsonl", "aliased", alias, shapes);
	write("fork.jsonl", "fork", repo, shapes);
	try {
		const report = await replayRule({ grit: consoleRule }, { root: repo, since, sessionsDir: logs });
		expect(report.hits.map((hit) => [hit.ref.split("/")[1], hit.path])).toEqual([
			["string", "src/s.js"],
			["single", "src/o.js"],
			["late", "src/late.js"],
			["final", "src/f.js"],
		]);
		expect(report.evaluated).toBe(4);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

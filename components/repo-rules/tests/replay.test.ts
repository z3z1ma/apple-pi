import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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
	const stale = session("stale.jsonl", "stale", root, [
		["stale", "2026-11-05T10:00:00Z", [call("write", { path: "src/s.js", content: "console.log(s);\n" })]],
	]);
	utimesSync(stale, new Date("2026-11-01"), new Date("2026-11-01"));
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

test("a code rule is replayed on the text recorded edits and writes added in this repository since the window start", async () => {
	const report = await replayRule({ grit: consoleRule, includes: ["src/**"] }, { root, since, sessionsDir });
	expect(report.hits).toEqual([
		{ at: "2026-11-05T10:00:00Z", ref: "entry:here/batch", path: "src/a.js", lines: [2] },
		{ at: "2026-11-05T10:00:00Z", ref: "entry:here/batch", path: "src/b.js", lines: [1] },
	]);
	expect(report.evaluated).toBe(3);
	expect(report.sessions).toBe(1);
	expect(report.notEvaluated).toEqual([]);
});

test("an action rule's pattern is replayed on recorded shell commands", async () => {
	const report = await replayRule({ pattern: "\\bgit\\s+push\\b" }, { root, since, sessionsDir });
	expect(report.hits).toEqual([
		{ at: "2026-11-05T10:00:00Z", ref: "entry:here/batch", command: "git push origin main" },
	]);
	expect(report.evaluated).toBe(2);
});

test("text the rule cannot evaluate is listed as not evaluated, never as allowed", async () => {
	const report = await replayRule({ grit: "language js\n\n`console.log(" }, { root, since, sessionsDir });
	expect(report.hits).toEqual([]);
	expect(report.evaluated).toBe(0);
	expect(report.notEvaluated.length).toBe(4);
});

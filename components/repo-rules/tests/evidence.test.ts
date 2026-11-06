import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { EVIDENCE_KINDS, sessionEvidence } from "../src/evidence.js";

const base = mkdtempSync(join(tmpdir(), "repo-rules-evidence-"));
const root = join(base, "repo");
const sessionsDir = join(base, "sessions");
const since = Date.parse("2026-11-04T00:00:00Z");

const note = (id: string, content: string) => ({ id, content });
const result = (toolName: string, text: string) => ({
	role: "toolResult",
	toolName,
	isError: true,
	content: [{ type: "text", text }],
});

function session(file: string, id: string, cwd: string, entries: Record<string, unknown>[]) {
	const lines = [{ type: "session", version: 3, id, timestamp: "2026-11-01T00:00:00Z", cwd }, ...entries];
	writeFileSync(join(sessionsDir, file), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
}

beforeAll(() => {
	mkdirSync(root, { recursive: true });
	mkdirSync(sessionsDir, { recursive: true });
	session("here.jsonl", "here", root, [
		{
			type: "custom",
			customType: "notebook.maintenance",
			id: "old",
			timestamp: "2026-11-03T00:00:00Z",
			data: { reflections: [note("n0", "Before the window.")] },
		},
		{
			type: "custom",
			customType: "notebook.maintenance",
			id: "m1",
			timestamp: "2026-11-05T09:00:00Z",
			data: { reflections: [note("n1", "Never batch an edit with its check.")] },
		},
		{
			type: "custom",
			customType: "notebook.maintenance",
			id: "m2",
			timestamp: "2026-11-05T09:30:00Z",
			data: { reflections: [note("n1", "Never batch an edit with its check."), note("n2", "Read the context file.")] },
		},
		{
			type: "message",
			id: "r1",
			timestamp: "2026-11-05T10:00:00Z",
			message: result("bash", "Refused: this message also edits files, and parallel calls run concurrently."),
		},
		{ type: "message", id: "f1", timestamp: "2026-11-05T10:05:00Z", message: result("bash", "exit code 1") },
		{
			type: "message",
			id: "f2",
			timestamp: "2026-11-05T10:06:00Z",
			message: result("edit", "Could not find the exact text to replace."),
		},
		{
			type: "message",
			id: "p1",
			timestamp: "2026-11-05T11:00:00Z",
			message: {
				role: "assistant",
				content: [{ type: "toolCall", id: "c1", name: "program_rpc_smoke", arguments: {} }],
			},
		},
	]);
	session("elsewhere.jsonl", "elsewhere", join(base, "other"), [
		{
			type: "custom",
			customType: "notebook.maintenance",
			id: "x",
			timestamp: "2026-11-05T09:00:00Z",
			data: { reflections: [note("nx", "Another repository's learning.")] },
		},
	]);
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

test("learnings, refusals, failed calls and program calls in this repository's window, each learning once", async () => {
	const evidence = await sessionEvidence({ root, since, sessionsDir, kinds: EVIDENCE_KINDS });
	expect(evidence.sessions).toBe(1);
	expect(evidence.items.map(({ kind, ref, tool, text }) => ({ kind, ref, tool, text }))).toEqual([
		{ kind: "learning", ref: "entry:here/m1", tool: undefined, text: "Never batch an edit with its check." },
		{ kind: "learning", ref: "entry:here/m2", tool: undefined, text: "Read the context file." },
		{
			kind: "refusal",
			ref: "entry:here/r1",
			tool: "bash",
			text: "Refused: this message also edits files, and parallel calls run concurrently.",
		},
		{ kind: "failure", ref: "entry:here/f2", tool: "edit", text: "Could not find the exact text to replace." },
		{ kind: "program_call", ref: "entry:here/p1", tool: "program_rpc_smoke", text: "program_rpc_smoke" },
	]);
});

test("only the asked kinds are read", async () => {
	const evidence = await sessionEvidence({ root, since, sessionsDir, kinds: ["refusal"] });
	expect(evidence.items.map((item) => item.kind)).toEqual(["refusal"]);
});

import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { readTranscriptEntries } from "../src/transcript-read.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const iso = (at: number) => new Date(at).toISOString();
const message = (id: string, at: number, text: string) =>
	JSON.stringify({
		type: "message",
		id,
		parentId: null,
		timestamp: iso(at),
		message: { role: "user", content: text, timestamp: at },
	});
// Pi writes these with their payload first and their own id last; the payload can hold ids of its own.
const mail = (id: string, at: number) =>
	JSON.stringify({
		type: "custom_message",
		customType: "apple-pi.mailbox-message",
		content: "<mail>hello</mail>",
		details: { id: "thread-message-7", thread: { id: "t-1" } },
		id,
		parentId: "x",
		timestamp: iso(at),
	});

function transcript(lines: string[]): string {
	const dir = mkdtempSync(join(tmpdir(), "transcript-read-"));
	dirs.push(dir);
	const file = join(dir, "session.jsonl");
	writeFileSync(file, `${JSON.stringify({ type: "session", id: "s", timestamp: iso(0) })}\n${lines.join("\n")}\n`);
	return file;
}

const T = 1_800_000_000_000;
/** Many old entries, about 6 MB, before the ones a test asks for. */
const history = Array.from({ length: 3000 }, (_, i) => message(`old-${i}`, T + i, "x".repeat(2000)));

test("finds an entry whose own id follows a payload holding other ids", async () => {
	const file = transcript([message("a", T, "hi"), mail("m", T + 1), message("b", T + 2, "bye")]);
	const { found } = await readTranscriptEntries(
		file,
		new Map([
			["m", T + 1],
			["a", T],
		]),
	);
	expect((found.get("m") as { customType: string }).customType).toBe("apple-pi.mailbox-message");
	expect((found.get("a") as { id: string }).id).toBe("a");
});

test("the newest page reads only the end of a long transcript", async () => {
	const file = transcript([...history, message("new-1", T + 5000, "one"), mail("new-2", T + 5001)]);
	const { found, bytes } = await readTranscriptEntries(
		file,
		new Map([
			["new-1", T + 5000],
			["new-2", T + 5001],
		]),
	);
	expect([...found.keys()].sort()).toEqual(["new-1", "new-2"]);
	expect(bytes).toBeLessThan(statSync(file).size / 2);
});

test("an indexed entry the file no longer holds ends the read at its time", async () => {
	const file = transcript([...history, message("kept", T + 5002, "kept")]);
	const { found, bytes } = await readTranscriptEntries(
		file,
		new Map([
			["kept", T + 5002],
			["gone", T + 5001],
		]),
	);
	expect([...found.keys()]).toEqual(["kept"]);
	expect(bytes).toBeLessThan(statSync(file).size / 2);
});

test("a line longer than one read, and the first line, are read whole", async () => {
	const long = message("long", T + 1, "y".repeat(3 << 20));
	const file = transcript([message("first", T, "start"), long, message("last", T + 2, "end")]);
	const { found } = await readTranscriptEntries(
		file,
		new Map([
			["first", T],
			["long", T + 1],
		]),
	);
	expect((found.get("long") as { message: { content: string } }).message.content).toHaveLength(3 << 20);
	expect((found.get("first") as { id: string }).id).toBe("first");
});

test("an entry with no known time is searched for to the start", async () => {
	const file = transcript([message("early", T, "early"), ...history]);
	const { found, bytes } = await readTranscriptEntries(file, new Map([["early", undefined]]));
	expect(found.has("early")).toBe(true);
	expect(bytes).toBe(statSync(file).size);
});

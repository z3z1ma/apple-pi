import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { NOTEPAD_FILE, openNotepads } from "../src/backend/notepad.js";
import type { Character, NotepadChange, WorldSnapshot } from "../src/world.js";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
	const home = mkdtempSync(join(tmpdir(), "aw-notepad-"));
	dirs.push(home);
	const coordinator = {
		id: "orla",
		name: "Orla",
		role: "coordinator",
		place: { kind: "headquarters", headquarters: "orla" },
		startedAt: 0,
		facts: { cwd: home },
	} as Character;
	const worker = { ...coordinator, id: "ada", role: "worker" } as Character;
	const snapshot = { characters: [coordinator, worker] } as WorldSnapshot;
	const changes: NotepadChange[] = [];
	const notepads = openNotepads(
		() => snapshot,
		(change) => changes.push(change),
	);
	return { home, file: join(home, NOTEPAD_FILE), notepads, changes };
}

test("a coordinator's notes are NOTES.md in its directory, empty until first saved", () => {
	const { file, notepads } = setup();
	try {
		expect(notepads.open("orla")).toEqual({ ok: true, path: file, text: "" });
		expect(notepads.save("orla", "first thoughts", "")).toEqual({ ok: true });
		expect(readFileSync(file, "utf8")).toBe("first thoughts");
	} finally {
		notepads.close();
	}
});

test("only a running coordinator has notes", () => {
	const { notepads } = setup();
	expect(notepads.open("ada")).toEqual({ ok: false, reason: "That coordinator is not running." });
	expect(notepads.open("nobody")).toEqual({ ok: false, reason: "That coordinator is not running." });
	expect(notepads.save("ada", "x", "")).toMatchObject({ ok: false });
});

test("a save over text that changed on disk is refused with the file's text", () => {
	const { file, notepads } = setup();
	writeFileSync(file, "mine");
	writeFileSync(file, "an agent's update");
	expect(notepads.save("orla", "mine, edited", "mine")).toEqual({
		ok: false,
		reason: "The notes changed on disk.",
		changed: "an agent's update",
	});
	expect(readFileSync(file, "utf8")).toBe("an agent's update");
});

test("a change on disk reaches the open notes, but a save from the notes does not come back", async () => {
	const { file, notepads, changes } = setup();
	try {
		notepads.open("orla");
		notepads.save("orla", "typed here", "");
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(changes).toEqual([]);
		writeFileSync(file, "typed here\nupdate from Ada");
		await vi.waitFor(() => expect(changes).toEqual([{ coordinatorId: "orla", text: "typed here\nupdate from Ada" }]), {
			timeout: 5000,
		});
		notepads.close();
		writeFileSync(file, "after closing");
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(changes).toHaveLength(1);
	} finally {
		notepads.close();
	}
});

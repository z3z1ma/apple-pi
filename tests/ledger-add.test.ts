import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addLedgerTask } from "../extensions/ledger.js";

const roots: string[] = [];

function temporaryRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "apple-pi-ledger-"));
	roots.push(root);
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("ledger add", () => {
	it("creates the minimal task and retrospective bundle with an index row", async () => {
		const root = temporaryRoot();
		const result = await addLedgerTask(
			root,
			"Implement bounded behavior",
			"Keep one production owner for the requested outcome",
			undefined,
			new Date(2026, 7, 17, 9, 5),
		);

		expect(result).toEqual({
			taskId: "202608170905-implement-bounded-behavior",
			bundlePath: ".ledger/202608170905-implement-bounded-behavior",
			taskPath: ".ledger/202608170905-implement-bounded-behavior/task.md",
			indexPath: ".ledger/INDEX.md",
		});
		expect(readdirSync(join(root, result.bundlePath)).sort()).toEqual(["retrospective.md", "task.md"]);
		expect(statSync(join(root, result.taskPath)).isFile()).toBe(true);
		expect(statSync(join(root, result.bundlePath, "retrospective.md")).isFile()).toBe(true);
		const task = readFileSync(join(root, result.taskPath), "utf8");
		expect(task).toBe(`Status: open
Created: 2026-08-17
Updated: 2026-08-17

# Implement bounded behavior

## Intent

Pending shaping.

## Current State

Open; pending shaping.

## Outcome

Pending shaping.
`);
		expect(readFileSync(join(root, result.bundlePath, "retrospective.md"), "utf8")).toBe(`Status: pending
Created: 2026-08-17
Updated: 2026-08-17

# Retrospective

## What Mattered

Pending completion of the undertaking.

## Learnings

Pending completion of the undertaking.

## Improvements

Pending completion of the undertaking.
`);
		expect(readFileSync(join(root, result.indexPath), "utf8")).toContain(
			"- `.ledger/202608170905-implement-bounded-behavior/task.md` — Implement bounded behavior — Keep one production owner for the requested outcome",
		);
	});

	it("refuses a collision without overwriting the existing task", async () => {
		const root = temporaryRoot();
		const now = new Date(2026, 7, 17, 9, 5);
		const first = await addLedgerTask(root, "Collision", "Do not overwrite an existing task id", undefined, now);
		const original = readFileSync(join(root, first.taskPath), "utf8");

		await expect(
			addLedgerTask(root, "Collision", "Do not overwrite an existing task id", undefined, now),
		).rejects.toThrow("already");
		expect(readFileSync(join(root, first.taskPath), "utf8")).toBe(original);
	});

	it("appends to an existing index without replacing its permissions", async () => {
		const root = temporaryRoot();
		await addLedgerTask(root, "First", "Preserve live index file mode", undefined, new Date(2026, 7, 17, 9, 5));
		const index = join(root, ".ledger/INDEX.md");
		chmodSync(index, 0o600);

		await addLedgerTask(root, "Second", "Append another searchable live row", undefined, new Date(2026, 7, 17, 9, 6));
		expect(statSync(index).mode & 0o777).toBe(0o600);
		const content = readFileSync(index, "utf8");
		expect(content).toContain("202608170905-first/task.md");
		expect(content).toContain("202608170906-second/task.md");
	});

	it("accepts the legacy live-index heading", async () => {
		const root = temporaryRoot();
		await addLedgerTask(root, "First", "Create the current live index", undefined, new Date(2026, 7, 17, 9, 5));
		const index = join(root, ".ledger/INDEX.md");
		writeFileSync(index, readFileSync(index, "utf8").replace("# Task ledger", "# Task Ledger"));

		await addLedgerTask(root, "Second", "Append through the legacy heading", undefined, new Date(2026, 7, 17, 9, 6));
		expect(readFileSync(index, "utf8")).toContain("202608170906-second/task.md");
	});

	it("does not leave a bundle when the existing index is invalid", async () => {
		const root = temporaryRoot();
		const ledger = join(root, ".ledger");
		await addLedgerTask(root, "Valid", "Existing index heading is required", undefined, new Date(2026, 7, 17, 9, 5));
		writeFileSync(join(ledger, "INDEX.md"), "not a ledger\n");

		await expect(
			addLedgerTask(
				root,
				"Rejected",
				"Invalid indexes must not create a bundle",
				undefined,
				new Date(2026, 7, 17, 9, 6),
			),
		).rejects.toThrow("# Task ledger");
		expect(readdirSync(ledger)).not.toContain("202608170906-rejected");
	});

	it("serializes simultaneous writers without losing either index row", async () => {
		const root = temporaryRoot();
		const [first, second] = await Promise.all([
			addLedgerTask(root, "First writer", "Retain the first concurrent row", undefined, new Date(2026, 7, 17, 9, 5)),
			addLedgerTask(root, "Second writer", "Retain the second concurrent row", undefined, new Date(2026, 7, 17, 9, 6)),
		]);
		const index = readFileSync(join(root, ".ledger/INDEX.md"), "utf8");
		expect(index).toContain(first.taskPath);
		expect(index).toContain(second.taskPath);
	});

	it("refuses an empty description", async () => {
		const root = temporaryRoot();
		await expect(
			addLedgerTask(root, "Needs a description", "   ", undefined, new Date(2026, 7, 17, 9, 5)),
		).rejects.toThrow("description");
	});
});

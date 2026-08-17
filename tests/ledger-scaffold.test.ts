import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scaffoldLedgerTask } from "../extensions/ledger.js";

const roots: string[] = [];

function temporaryRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "apple-pi-ledger-"));
	roots.push(root);
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("ledger scaffold", () => {
	it("creates the full structural bundle and index row", async () => {
		const root = temporaryRoot();
		const result = await scaffoldLedgerTask(
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
			indexPath: ".ledger/index.md",
		});
		expect(readdirSync(join(root, result.bundlePath)).sort()).toEqual(
			["decisions", "evidence", "knowledge", "plans", "research", "skills", "specs", "task.md"].sort(),
		);
		const task = readFileSync(join(root, result.taskPath), "utf8");
		expect(task).toContain("Status: open\nCreated: 2026-08-17\nUpdated: 2026-08-17");
		expect(task).toContain("# Implement bounded behavior");
		expect(task).toContain("Shaping is incomplete; replace every scaffold placeholder before execution.");
		expect(readFileSync(join(root, result.indexPath), "utf8")).toContain(
			"- `.ledger/202608170905-implement-bounded-behavior/task.md` — Implement bounded behavior — Keep one production owner for the requested outcome",
		);
	});

	it("refuses a collision without overwriting the existing task", async () => {
		const root = temporaryRoot();
		const now = new Date(2026, 7, 17, 9, 5);
		const first = await scaffoldLedgerTask(root, "Collision", "Do not overwrite an existing task id", undefined, now);
		const original = readFileSync(join(root, first.taskPath), "utf8");

		await expect(
			scaffoldLedgerTask(root, "Collision", "Do not overwrite an existing task id", undefined, now),
		).rejects.toThrow("already");
		expect(readFileSync(join(root, first.taskPath), "utf8")).toBe(original);
	});

	it("appends to an existing index without replacing its permissions", async () => {
		const root = temporaryRoot();
		await scaffoldLedgerTask(root, "First", "Preserve live index file mode", undefined, new Date(2026, 7, 17, 9, 5));
		const index = join(root, ".ledger/index.md");
		chmodSync(index, 0o600);

		await scaffoldLedgerTask(
			root,
			"Second",
			"Append another searchable live row",
			undefined,
			new Date(2026, 7, 17, 9, 6),
		);
		expect(statSync(index).mode & 0o777).toBe(0o600);
		const content = readFileSync(index, "utf8");
		expect(content).toContain("202608170905-first/task.md");
		expect(content).toContain("202608170906-second/task.md");
	});

	it("does not leave a bundle when the existing index is invalid", async () => {
		const root = temporaryRoot();
		const ledger = join(root, ".ledger");
		await scaffoldLedgerTask(
			root,
			"Valid",
			"Existing index heading is required",
			undefined,
			new Date(2026, 7, 17, 9, 5),
		);
		writeFileSync(join(ledger, "index.md"), "not a ledger\n");

		await expect(
			scaffoldLedgerTask(
				root,
				"Rejected",
				"Invalid indexes must not create a bundle",
				undefined,
				new Date(2026, 7, 17, 9, 6),
			),
		).rejects.toThrow("# Task Ledger");
		expect(readdirSync(ledger)).not.toContain("202608170906-rejected");
	});

	it("refuses an empty description", async () => {
		const root = temporaryRoot();
		await expect(
			scaffoldLedgerTask(root, "Needs a description", "   ", undefined, new Date(2026, 7, 17, 9, 5)),
		).rejects.toThrow("description");
	});
});

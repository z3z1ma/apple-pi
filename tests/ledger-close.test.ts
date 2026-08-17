import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeLedgerTask, scaffoldLedgerTask } from "../extensions/ledger.js";

const roots: string[] = [];

function temporaryRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "apple-pi-ledger-close-"));
	roots.push(root);
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("ledger close", () => {
	it("archives a live task as done and records terminal status", async () => {
		const root = temporaryRoot();
		const created = await scaffoldLedgerTask(
			root,
			"Implement bounded behavior",
			"Keep one production owner for the requested outcome",
			undefined,
			new Date(2026, 7, 17, 9, 5),
		);

		const closed = await closeLedgerTask(root, created.taskId, "done");

		expect(closed).toEqual({
			taskId: created.taskId,
			status: "done",
			bundlePath: ".ledger/history/202608170905-implement-bounded-behavior",
			taskPath: ".ledger/history/202608170905-implement-bounded-behavior/task.md",
			indexPath: ".ledger/history/index.md",
		});
		expect(existsSync(join(root, created.bundlePath))).toBe(false);
		expect(readFileSync(join(root, closed.taskPath), "utf8")).toMatch(/^Status: done$/m);
		expect(readFileSync(join(root, ".ledger/index.md"), "utf8")).not.toContain(created.taskPath);
		expect(readFileSync(join(root, closed.indexPath), "utf8")).toContain(
			"- `.ledger/history/202608170905-implement-bounded-behavior/task.md` — done — Implement bounded behavior — Keep one production owner for the requested outcome",
		);
	});

	it("accepts a task path and leaves an already-matching status in place", async () => {
		const root = temporaryRoot();
		const created = await scaffoldLedgerTask(
			root,
			"Cancel leftover work",
			"Archive leftover scope without inventing completion",
			undefined,
			new Date(2026, 7, 17, 9, 7),
		);
		writeFileSync(
			join(root, created.taskPath),
			readFileSync(join(root, created.taskPath), "utf8").replace("Status: open", "Status: cancelled"),
		);

		const closed = await closeLedgerTask(root, created.taskPath, "cancelled");

		expect(closed.status).toBe("cancelled");
		expect(readFileSync(join(root, closed.taskPath), "utf8")).toMatch(/^Status: cancelled$/m);
		expect(readFileSync(join(root, closed.indexPath), "utf8")).toContain(
			"— cancelled — Cancel leftover work — Archive leftover scope without inventing completion",
		);
	});

	it("does not rewrite other tasks' Depends-On lines", async () => {
		const root = temporaryRoot();
		const dependency = await scaffoldLedgerTask(
			root,
			"Establish prerequisite",
			"Record the shared precondition other tasks depend on",
			undefined,
			new Date(2026, 7, 17, 9, 5),
		);
		const dependent = await scaffoldLedgerTask(
			root,
			"Use the prerequisite",
			"Keep Depends-On in live identity form after archive",
			undefined,
			new Date(2026, 7, 17, 9, 6),
		);
		const original = readFileSync(join(root, dependent.taskPath), "utf8").replace(
			"Updated: 2026-08-17\n",
			`Updated: 2026-08-17\nDepends-On: ${dependency.taskPath}\n`,
		);
		writeFileSync(join(root, dependent.taskPath), original);

		await closeLedgerTask(root, dependency.taskId, "done");

		expect(readFileSync(join(root, dependent.taskPath), "utf8")).toContain(`Depends-On: ${dependency.taskPath}`);
		expect(existsSync(join(root, ".ledger/history", dependency.taskId, "task.md"))).toBe(true);
	});

	it("preserves live-index permissions when removing the archived row", async () => {
		const root = temporaryRoot();
		await scaffoldLedgerTask(root, "Keep me", "Remain on the live index", undefined, new Date(2026, 7, 17, 9, 5));
		const closing = await scaffoldLedgerTask(
			root,
			"Archive me",
			"Leave the live index mode unchanged",
			undefined,
			new Date(2026, 7, 17, 9, 6),
		);
		const index = join(root, ".ledger/index.md");
		chmodSync(index, 0o600);

		await closeLedgerTask(root, closing.taskId, "done");

		expect(statSync(index).mode & 0o777).toBe(0o600);
		const live = readFileSync(index, "utf8");
		expect(live).toContain("202608170905-keep-me/task.md");
		expect(live).not.toContain("202608170906-archive-me/task.md");
	});

	it("refuses a missing, already archived, or history-path task", async () => {
		const root = temporaryRoot();
		const created = await scaffoldLedgerTask(
			root,
			"Once",
			"Refuse a second close of the same id",
			undefined,
			new Date(2026, 7, 17, 9, 5),
		);
		await closeLedgerTask(root, created.taskId, "done");

		await expect(closeLedgerTask(root, "202608170906-missing", "done")).rejects.toThrow("not found");
		await expect(closeLedgerTask(root, created.taskId, "done")).rejects.toThrow("already archived");
		await expect(closeLedgerTask(root, `.ledger/history/${created.taskId}`, "done")).rejects.toThrow(
			"already archived",
		);
	});

	it("does not create a live task whose id is already in history", async () => {
		const root = temporaryRoot();
		const now = new Date(2026, 7, 17, 9, 5);
		await closeLedgerTask(
			root,
			(await scaffoldLedgerTask(root, "Once", "History ids stay reserved", undefined, now)).taskId,
			"cancelled",
		);

		await expect(scaffoldLedgerTask(root, "Once", "History ids stay reserved", undefined, now)).rejects.toThrow(
			"already archived",
		);
	});
});

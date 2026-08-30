import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeLedgerTask, addLedgerTask } from "../extensions/ledger.js";

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
		const created = await addLedgerTask(
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
			indexPath: ".ledger/history/INDEX.md",
		});
		expect(existsSync(join(root, created.bundlePath))).toBe(false);
		expect(readFileSync(join(root, closed.taskPath), "utf8")).toMatch(/^Status: done$/m);
		expect(readFileSync(join(root, ".ledger/INDEX.md"), "utf8")).not.toContain(created.taskPath);
		expect(readFileSync(join(root, closed.indexPath), "utf8")).toContain(
			"- `.ledger/history/202608170905-implement-bounded-behavior/task.md` — done — Implement bounded behavior — Keep one production owner for the requested outcome",
		);
	});

	it("shares the writer lease with add without losing either transaction", async () => {
		const root = temporaryRoot();
		const existing = await addLedgerTask(
			root,
			"Archive concurrently",
			"Move this task while another one is added",
			undefined,
			new Date(2026, 7, 17, 9, 5),
		);
		const [closed, added] = await Promise.all([
			closeLedgerTask(root, existing.taskId, "done"),
			addLedgerTask(root, "Add concurrently", "Keep this new task live", undefined, new Date(2026, 7, 17, 9, 6)),
		]);
		expect(existsSync(join(root, closed.taskPath))).toBe(true);
		const live = readFileSync(join(root, ".ledger/INDEX.md"), "utf8");
		expect(live).not.toContain(existing.taskPath);
		expect(live).toContain(added.taskPath);
		expect(readFileSync(join(root, closed.indexPath), "utf8")).toContain(closed.taskPath);
	});

	it("accepts a task path and leaves an already-matching status in place", async () => {
		const root = temporaryRoot();
		const created = await addLedgerTask(
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
		const dependency = await addLedgerTask(
			root,
			"Establish prerequisite",
			"Record the shared precondition other tasks depend on",
			undefined,
			new Date(2026, 7, 17, 9, 5),
		);
		const dependent = await addLedgerTask(
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
		await addLedgerTask(root, "Keep me", "Remain on the live index", undefined, new Date(2026, 7, 17, 9, 5));
		const closing = await addLedgerTask(
			root,
			"Archive me",
			"Leave the live index mode unchanged",
			undefined,
			new Date(2026, 7, 17, 9, 6),
		);
		const index = join(root, ".ledger/INDEX.md");
		chmodSync(index, 0o600);

		await closeLedgerTask(root, closing.taskId, "done");

		expect(statSync(index).mode & 0o777).toBe(0o600);
		const live = readFileSync(index, "utf8");
		expect(live).toContain("202608170905-keep-me/task.md");
		expect(live).not.toContain("202608170906-archive-me/task.md");
	});

	it("rejects invalid history-index preconditions before changing task status", async () => {
		const root = temporaryRoot();
		const created = await addLedgerTask(
			root,
			"Reject bad history",
			"Invalid destinations cannot partially close tasks",
			undefined,
			new Date(2026, 7, 17, 9, 5),
		);
		const task = join(root, created.taskPath);
		const original = readFileSync(task, "utf8");
		mkdirSync(join(root, ".ledger/history"), { recursive: true });
		writeFileSync(join(root, ".ledger/history/INDEX.md"), "not a task history\n");

		await expect(closeLedgerTask(root, created.taskId, "done")).rejects.toThrow("# Task History");
		expect(readFileSync(task, "utf8")).toBe(original);
		expect(existsSync(join(root, ".ledger/history", created.taskId))).toBe(false);
	});

	it("refuses a missing, already archived, or history-path task", async () => {
		const root = temporaryRoot();
		const created = await addLedgerTask(
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
			(await addLedgerTask(root, "Once", "History ids stay reserved", undefined, now)).taskId,
			"cancelled",
		);

		await expect(addLedgerTask(root, "Once", "History ids stay reserved", undefined, now)).rejects.toThrow(
			"already archived",
		);
	});
});

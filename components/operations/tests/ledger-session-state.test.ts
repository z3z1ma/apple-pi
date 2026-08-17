import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	ACTIVE_TASK_ENTRY,
	ACTIVE_TASK_TOMBSTONE,
	foldActiveTaskPointer,
	projectOperationsSession,
} from "../src/session-state.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function gitRepo(): string {
	const root = mkdtempSync(join(tmpdir(), "ledger-session-"));
	roots.push(root);
	execFileSync("git", ["init", "-q", root]);
	execFileSync("git", ["-C", root, "config", "user.email", "ops@example.test"]);
	execFileSync("git", ["-C", root, "config", "user.name", "Ops"]);
	const task = ".ledger/202608151200-session-task/task.md";
	mkdirSync(join(root, ".ledger/202608151200-session-task"), { recursive: true });
	writeFileSync(
		join(root, task),
		`Status: open
Created: 2026-08-15
Updated: 2026-08-15

# Session task

## Scope

Session pointer tests.

## Non-goals

None here.

## Acceptance Criteria

- AC-001: Pointers reconstruct from the branch.

## References

None.

## Assumptions

None.

## Journal

- Opened.

## Blockers

None.

## Evidence

Pending.

## Review

Pending.

## Retrospective

Pending.

## Distillation

Pending.
`,
	);
	writeFileSync(join(root, ".ledger/README.md"), `# Task Ledger\n\n- \`${task}\`\n`);
	execFileSync("git", ["-C", root, "add", "."]);
	execFileSync("git", ["-C", root, "commit", "-qm", "ledger"]);
	return root;
}

describe("ledger session state", () => {
	it("folds last-valid pointers, tombstones, and malformed entries without fallback", () => {
		const first = {
			customType: ACTIVE_TASK_ENTRY,
			data: { schemaVersion: 1, ledgerRoot: "/one", taskPath: ".ledger/202608151200-session-task/task.md" },
		};
		const malformed = { customType: ACTIVE_TASK_ENTRY, data: { schemaVersion: 1, taskPath: "nope" } };
		const second = {
			customType: ACTIVE_TASK_ENTRY,
			data: { schemaVersion: 1, ledgerRoot: "/two", taskPath: ".ledger/202608151200-session-task/task.md" },
		};
		expect(foldActiveTaskPointer([first, malformed])?.ledgerRoot).toBe("/one");
		expect(foldActiveTaskPointer([first, second])?.ledgerRoot).toBe("/two");
		expect(
			foldActiveTaskPointer([
				first,
				second,
				{ customType: ACTIVE_TASK_TOMBSTONE, data: { schemaVersion: 1, cleared: true } },
			]),
		).toBeUndefined();
		expect(
			foldActiveTaskPointer([
				first,
				{ customType: ACTIVE_TASK_TOMBSTONE, data: { schemaVersion: 1, cleared: true } },
				malformed,
			]),
		).toBeUndefined();
	});

	it("keeps a stale latest pointer instead of restoring an older one", () => {
		const root = gitRepo();
		const other = mkdtempSync(join(tmpdir(), "ledger-unrelated-"));
		roots.push(other);
		execFileSync("git", ["init", "-q", other]);
		const projection = projectOperationsSession(
			[
				{
					customType: ACTIVE_TASK_ENTRY,
					data: {
						schemaVersion: 1,
						ledgerRoot: root,
						taskPath: ".ledger/202608151200-session-task/task.md",
					},
				},
				{
					customType: ACTIVE_TASK_ENTRY,
					data: {
						schemaVersion: 1,
						ledgerRoot: other,
						taskPath: ".ledger/202608151200-session-task/task.md",
					},
				},
			],
			root,
		);
		expect(projection.activeTask.pointer?.ledgerRoot).toBe(other);
		expect(projection.activeTask.stale).toBe("unrelated");
	});
});

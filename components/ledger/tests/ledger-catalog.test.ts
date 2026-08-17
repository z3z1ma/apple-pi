import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { filterCatalogTasks, inspectLedgerTask, listLedgerTasks } from "../src/catalog.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function taskBody(title: string, status = "open"): string {
	return `Status: ${status}
Created: 2026-08-15
Updated: 2026-08-15

# ${title}

## Scope

Do the thing.

## Non-goals

No extras.

## Acceptance Criteria

- AC-001: The behavior is implemented and verified.

## Work Items

- [ ] WI-001: Implement the catalog projection path.

## References

None.

## Assumptions

Record-backed.

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
`;
}

function repo(): string {
	const root = mkdtempSync(join(tmpdir(), "ralph-catalog-"));
	roots.push(root);
	execFileSync("git", ["init", "-q", root]);
	const a = ".ledger/202608151200-alpha-task/task.md";
	const b = ".ledger/202608151201-harness-operations-ui/task.md";
	mkdirSync(join(root, ".ledger/202608151200-alpha-task"), { recursive: true });
	mkdirSync(join(root, ".ledger/202608151201-harness-operations-ui"), { recursive: true });
	writeFileSync(join(root, a), taskBody("Alpha work"));
	writeFileSync(join(root, b), taskBody("Build harness operations UI", "active"));
	writeFileSync(join(root, ".ledger/README.md"), `# Task Ledger\n\n- \`${a}\` — Alpha\n- \`${b}\` — Harness\n`);
	return root;
}

describe("ledger catalog", () => {
	it("derives title and status from task.md and rejects unindexed or unsafe paths", () => {
		const root = repo();
		const tasks = listLedgerTasks(root);
		expect(tasks.map((task) => task.status)).toEqual(["open", "active"]);
		expect(tasks[1]?.title).toBe("Build harness operations UI");
		expect(tasks[1]?.workItems).toEqual({ open: 1, complete: 0, cancelled: 0, total: 1 });
		const filtered = filterCatalogTasks(tasks, "operations");
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.taskId).toContain("harness-operations-ui");
		expect(() => inspectLedgerTask(root, ".ledger/202608151200-missing/task.md")).toThrow(/does not list task/);
		expect(() => inspectLedgerTask(root, "../outside/task.md")).toThrow(/Unsafe|Invalid/);
	});
});

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mutateTaskWorkItems } from "../src/task.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function digest(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

function task(status = "active", workItems = ""): string {
	return `Status: ${status}
Created: 2026-08-15
Updated: 2026-08-15

# Work

## Scope

One thing.

## Non-goals

None.

## Acceptance Criteria

- AC-001: Works.

${workItems}## References

None.

## Assumptions

Record-backed.

## Journal

Opened.

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

function writeTask(status = "active", workItems = ""): { path: string; digest: string } {
	const root = mkdtempSync(join(tmpdir(), "ledger-task-"));
	roots.push(root);
	const dir = join(root, ".ledger", "202608151200-work");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "task.md");
	const content = task(status, workItems);
	writeFileSync(path, content, "utf8");
	return { path, digest: digest(content) };
}

describe("mutateTaskWorkItems", () => {
	it("refuses to add open work to a done task", async () => {
		const { path, digest: beforeDigest } = writeTask("done");
		const before = readFileSync(path, "utf8");
		await expect(
			mutateTaskWorkItems(path, beforeDigest, {
				kind: "add",
				id: "WI-001",
				description: "Reopen the completed task through an authorized follow-up.",
			}),
		).rejects.toThrow(/done task cannot contain open work items/);
		expect(readFileSync(path, "utf8")).toBe(before);
	});

	it("mutates work items and preserves failed task bytes", async () => {
		const written = writeTask();
		let { path, digest: current } = written;
		let mutation = await mutateTaskWorkItems(path, current, {
			kind: "add",
			id: "WI-001",
			description: "Implement the canonical work-item mutation boundary.",
		});
		current = mutation.digest;
		mutation = await mutateTaskWorkItems(path, current, {
			kind: "add",
			id: "WI-002",
			description: "Preserve atomic failures under compare-and-swap.",
		});
		current = mutation.digest;
		mutation = await mutateTaskWorkItems(path, current, { kind: "reorder", id: "WI-002", beforeId: "WI-001" });
		current = mutation.digest;
		expect(readFileSync(path, "utf8")).toMatch(/WI-002[\s\S]*WI-001/);
		mutation = await mutateTaskWorkItems(path, current, { kind: "complete", id: "WI-001" });
		current = mutation.digest;
		mutation = await mutateTaskWorkItems(path, current, { kind: "reopen", id: "WI-001" });
		current = mutation.digest;
		mutation = await mutateTaskWorkItems(path, current, {
			kind: "cancel",
			id: "WI-001",
			reason: "No longer required because the active specification excludes it.",
		});
		const beforeFailure = readFileSync(path, "utf8");
		await expect(mutateTaskWorkItems(path, mutation.digest, { kind: "complete", id: "WI-001" })).rejects.toThrow(
			/Only open/,
		);
		await expect(
			mutateTaskWorkItems(path, current, {
				kind: "add",
				id: "WI-003",
				description: "Stale writes must not alter the task document.",
			}),
		).rejects.toThrow(/changed concurrently/);
		expect(readFileSync(path, "utf8")).toBe(beforeFailure);
	});
});

import { describe, expect, it } from "vitest";
import { parseTaskDocument } from "../components/ralph/src/task-document.js";

function task(workItems = ""): string {
	return `Status: active
Created: 2026-08-15
Updated: 2026-08-15

# Implement bounded behavior

## Scope

Implement one bounded behavior.

## Non-goals

- No adjacent refactor.

## Acceptance Criteria

- AC-001: The behavior is observable.

${workItems}## References

None.

## Assumptions

- Record-backed.

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

describe("parseTaskDocument", () => {
	it("preserves no-work-item task compatibility", () => {
		const document = parseTaskDocument(task());
		expect(document.title).toBe("Implement bounded behavior");
		expect(document.criteria).toEqual([{ id: "AC-001", text: "The behavior is observable." }]);
		expect(document.workItems).toEqual([]);
		expect(document.workItemIssues).toEqual([]);
	});

	it("parses canonical open, complete, and cancelled work items", () => {
		const document = parseTaskDocument(task(`## Work Items

- [ ] WI-001: Implement the canonical parser.
- [x] WI-002: Preserve no-work-item compatibility.
- [-] WI-003: Remove speculative scope — Cancelled: No longer required because the active specification excludes it.

`));
		expect(document.workItems).toEqual([
			{ id: "WI-001", state: "open", description: "Implement the canonical parser." },
			{ id: "WI-002", state: "complete", description: "Preserve no-work-item compatibility." },
			{ id: "WI-003", state: "cancelled", description: "Remove speculative scope", cancellationReason: "No longer required because the active specification excludes it." },
		]);
		expect(document.workItemIssues).toEqual([]);
	});

	it("reports the source line of a malformed work-item row", () => {
		const content = task(`## Work Items

- [ ] WI-001: Implement the canonical parser.
- [ ] wi-002: Lowercase IDs are malformed.

`);
		const document = parseTaskDocument(content);
		const issue = document.workItemIssues.find((item) => item.code === "malformed_work_item");
		expect(issue?.line).toBe(content.split(/\r?\n/).findIndex((line) => line.includes("wi-002")) + 1);
	});

	it("reports malformed, duplicate, non-substantive, and misplaced work items", () => {
		const malformed = parseTaskDocument(task(`## Work Items

- [ ] WI-001: Do it.
- [x] WI-001: Duplicate identifier with substantive detail.
- [-] WI-002: Cancel the scope — Cancelled: No.
- [ ] WI-003 missing colon
- [ ] wi-004: Lowercase identifiers are malformed.
- [ ] WI-ABC: Alphabetic identifiers are malformed.
This note would otherwise be erased by a mutation.
- [ ] WI-004: TODO: describe this later.
- [-] WI-005: Cancel this scope — Cancelled: Pending implementation detail.

`));
		expect(malformed.workItemIssues.map((issue) => issue.code)).toEqual([
			"non_substantive_work_item",
			"duplicate_work_item",
			"non_substantive_cancellation",
			"malformed_work_item",
			"malformed_work_item",
			"malformed_work_item",
			"malformed_work_item",
			"non_substantive_work_item",
			"non_substantive_cancellation",
		]);

		const misplaced = parseTaskDocument(task().replace("# Implement bounded behavior", "- [ ] wi-001: This appears before the first section.\n\n# Implement bounded behavior").replace("## References", "- [ ] WI-002: This appears outside the work item section.\n\n## References"));
		expect(misplaced.workItemIssues.filter((issue) => issue.code === "misplaced_work_item")).toHaveLength(2);

		const proseReference = parseTaskDocument(task().replace("- Opened.", "- Ralph iteration considered WI-001 but left it open.").replace("## Review\n\nPending.", "## Review\n\n- WI-001: **confirmed** — reviewed evidence."));
		expect(proseReference.workItemIssues).toEqual([]);
	});
});

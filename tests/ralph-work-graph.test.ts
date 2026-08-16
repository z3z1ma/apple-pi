import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectionText } from "../components/ralph/src/index.js";
import { hasDistillation, hasRetrospective, compileWorkGraph, missingCriterionEvidence } from "../components/ralph/src/work-graph.js";

const roots: string[] = [];
const TASK = ".ledger/202608151200-implement-behavior/task.md";
const BUNDLE = ".ledger/202608151200-implement-behavior";
const DEPENDENCY = ".ledger/202608141100-establish-boundary/task.md";

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(taskPaths: string[] = [TASK]): string {
	const root = mkdtempSync(join(tmpdir(), "ralph-graph-"));
	roots.push(root);
	put(root, ".ledger/README.md", `# Task Ledger\n\n${taskPaths.map((path) => `- \`${path}\``).join("\n")}\n`);
	return root;
}

function put(root: string, path: string, content: string): void {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), content, "utf8");
}

function task(extra: { status?: string; created?: string; headers?: string; references?: string; blockers?: string; evidence?: string; retrospective?: string; distillation?: string } = {}): string {
	return `Status: ${extra.status ?? "active"}
Created: ${extra.created ?? "2026-08-15"}
Updated: ${extra.created ?? "2026-08-15"}
${extra.headers ?? ""}
# Implement bounded behavior

## Scope

Implement one bounded behavior.

## Non-goals

- No adjacent refactor.

## Acceptance Criteria

- AC-001: The behavior is observable.
- AC-002: The failure path remains visible.

## References

${extra.references ?? ""}

## Assumptions

- Record-backed by the referenced spec.

## Journal

- Opened.

## Blockers

${extra.blockers ?? "None."}

## Evidence

${extra.evidence ?? "Pending."}

## Review

Pending.

## Retrospective

${extra.retrospective ?? "Pending."}

## Distillation

${extra.distillation ?? "Pending."}
`;
}

function record(status: string, title: string, related = ""): string {
	return `Status: ${status}\nCreated: 2026-08-14\nUpdated: 2026-08-14\n\n# ${title}\n${related ? `\n## Related Records\n\n${related}\n` : ""}`;
}

describe("compileWorkGraph", () => {
	it("projects bounded canonical work-item IDs and states in inspection output", () => {
		const root = project();
		put(root, TASK, task().replace("## References", "## Work Items\n\n- [ ] WI-001: Implement the first bounded work item.\n- [x] WI-002: Preserve completed work-item visibility.\n\n## References"));
		expect(inspectionText(compileWorkGraph(root, TASK))).toContain("Work Items: 2 total; 1 open; WI-001 (open), WI-002 (complete)");
	});
	it("compiles one deterministic self-contained task graph plus completed dependencies", () => {
		const root = project([TASK, DEPENDENCY]);
		put(root, DEPENDENCY, task({ status: "done", created: "2026-08-14", evidence: "- AC-001: Previously observed boundary behavior.\n- AC-002: Previously observed failure behavior.", retrospective: "The prior boundary made integration behavior explicit.", distillation: "The implementation and tests remain the durable owners." }));
		put(root, `${BUNDLE}/specs/behavior.md`, record("active", "Behavior", `- \`${BUNDLE}/decisions/choice.md\``));
		put(root, `${BUNDLE}/decisions/choice.md`, record("active", "Choice"));
		put(root, `${BUNDLE}/plans/implementation.md`, record("active", "Plan"));
		put(root, `${BUNDLE}/research/findings.md`, record("done", "Findings"));
		put(root, `${BUNDLE}/evidence/observation.md`, record("recorded", "Observation"));
		put(root, `${BUNDLE}/knowledge/vocabulary.md`, record("active", "Vocabulary"));
		put(root, `${BUNDLE}/skills/replay-fixture/SKILL.md`, "---\nname: replay-fixture\ndescription: Use when replaying the task fixture.\n---\n\n# Replay Fixture\n");
		put(root, TASK, task({
			headers: `Depends-On: ${DEPENDENCY}`,
			references: `- \`${BUNDLE}/specs/behavior.md\`\n- \`${BUNDLE}/plans/implementation.md\`\n- \`${BUNDLE}/research/findings.md\`\n- \`${BUNDLE}/evidence/observation.md\`\n- \`${BUNDLE}/knowledge/vocabulary.md\`\n- \`${BUNDLE}/skills/replay-fixture/SKILL.md\`\n- \`src/owner.ts\``,
		}));

		const first = compileWorkGraph(root, TASK);
		const second = compileWorkGraph(root, TASK);
		expect(first.records.map((item) => [item.kind, item.path])).toEqual([
			["task", TASK],
			["task", DEPENDENCY],
			["spec", `${BUNDLE}/specs/behavior.md`],
			["decision", `${BUNDLE}/decisions/choice.md`],
			["plan", `${BUNDLE}/plans/implementation.md`],
			["research", `${BUNDLE}/research/findings.md`],
			["knowledge", `${BUNDLE}/knowledge/vocabulary.md`],
			["skill", `${BUNDLE}/skills/replay-fixture/SKILL.md`],
			["evidence", `${BUNDLE}/evidence/observation.md`],
		]);
		expect(first.sourcePointers).toEqual(["src/owner.ts"]);
		expect(first.graphHash).toBe(second.graphHash);
		expect(first.bundle).toBe(second.bundle);
		expect(first.bundle.indexOf(TASK)).toBeLessThan(first.bundle.indexOf(`${BUNDLE}/specs/behavior.md`));
	});

	it("rejects missing records, blockers, stale authority, and context overflow", () => {
		const missing = project();
		put(missing, TASK, task({ references: `- \`${BUNDLE}/specs/missing.md\`` }));
		expect(() => compileWorkGraph(missing, TASK)).toThrowError(/does not exist/);

		const blocked = project();
		put(blocked, TASK, task({ blockers: "- Need a semantic decision." }));
		expect(() => compileWorkGraph(blocked, TASK)).toThrowError(/unresolved blockers/);

		const stale = project();
		put(stale, `${BUNDLE}/specs/old.md`, record("superseded", "Old"));
		put(stale, TASK, task({ references: `- \`${BUNDLE}/specs/old.md\`` }));
		expect(() => compileWorkGraph(stale, TASK)).toThrowError(/expected active/);

		const large = project();
		put(large, TASK, task());
		expect(() => compileWorkGraph(large, TASK, { maxBytes: 100 })).toThrowError(/limit is 100/);
	});

	it("enforces canonical task bundles, index membership, and local record ownership", () => {
		const legacy = project();
		expect(() => compileWorkGraph(legacy, ".10x/tickets/work.md")).toThrowError(/migrate.*\.ledger/i);

		const unindexed = project([]);
		put(unindexed, TASK, task());
		expect(() => compileWorkGraph(unindexed, TASK)).toThrowError(/does not list task/);

		const mismatched = project();
		put(mismatched, TASK, task({ created: "2026-08-14" }));
		expect(() => compileWorkGraph(mismatched, TASK)).toThrowError(/Created date must match/);

		const badTimestampPath = ".ledger/202613011200-invalid-date/task.md";
		const badTimestamp = project([badTimestampPath]);
		put(badTimestamp, badTimestampPath, task());
		expect(() => compileWorkGraph(badTimestamp, badTimestampPath)).toThrowError(/YYYYMMDDhhmm/);

		const cross = project([TASK, DEPENDENCY]);
		put(cross, DEPENDENCY, task({ status: "done", created: "2026-08-14" }));
		put(cross, TASK, task({ references: `- \`.ledger/202608141100-establish-boundary/specs/private.md\`` }));
		put(cross, ".ledger/202608141100-establish-boundary/specs/private.md", record("active", "Private"));
		expect(() => compileWorkGraph(cross, TASK)).toThrowError(/may not reference another task bundle/);

		const alias = project();
		put(alias, `${BUNDLE}/specs/behavior.md`, record("active", "Behavior"));
		put(alias, TASK, task({ references: `- \`${BUNDLE}/specs/../specs/behavior.md\`` }));
		expect(() => compileWorkGraph(alias, TASK)).toThrowError(/canonical/);

		const malformed = project();
		put(malformed, TASK, task().replace("Updated: 2026-08-15\n", ""));
		expect(() => compileWorkGraph(malformed, TASK)).toThrowError(/missing required header: updated/);
	});

	it("rejects local record cycles and transitive task dependency cycles", () => {
		const local = project();
		put(local, `${BUNDLE}/specs/a.md`, record("active", "A", `- \`${BUNDLE}/decisions/b.md\``));
		put(local, `${BUNDLE}/decisions/b.md`, record("active", "B", `- \`${BUNDLE}/specs/a.md\``));
		put(local, TASK, task({ references: `- \`${BUNDLE}/specs/a.md\`` }));
		expect(() => compileWorkGraph(local, TASK)).toThrowError(/cycle/);

		const B = ".ledger/202608141100-dependency-b/task.md";
		const C = ".ledger/202608131100-dependency-c/task.md";
		const dependency = project([TASK, B, C]);
		put(dependency, TASK, task({ headers: `Depends-On: ${B}` }));
		put(dependency, B, task({ status: "done", created: "2026-08-14", headers: `Depends-On: ${C}` }));
		put(dependency, C, task({ status: "done", created: "2026-08-13", headers: `Depends-On: ${B}` }));
		expect(() => compileWorkGraph(dependency, TASK)).toThrowError(/cycle/);
	});

	it("uses the canonical work-item parser and rejects malformed work-item state", () => {
		const valid = project();
		put(valid, TASK, task().replace("## References", "## Work Items\n\n- [ ] WI-001: Implement the canonical task parser.\n\n## References"));
		const graph = compileWorkGraph(valid, TASK);
		expect(graph.task.taskDocument?.workItems).toEqual([{ id: "WI-001", state: "open", description: "Implement the canonical task parser." }]);

		const invalid = project();
		put(invalid, TASK, task().replace("## References", "## Work Items\n\n- [ ] WI-ABC: Malformed identifiers must remain visible.\n\n## References"));
		expect(() => compileWorkGraph(invalid, TASK)).toThrowError(/invalid Work Items/);
	});

	it("checks durable acceptance evidence, retrospective, and distillation", () => {
		const root = project();
		put(root, TASK, task({
			evidence: "- AC-001: `npm test` passed; proves the named behavior only.",
			retrospective: "The boundary failed because inferred state was ambiguous; explicit state removed that ambiguity.",
			distillation: "No separate document: implementation tests own this bounded invariant and no reusable operation emerged.",
		}));
		const graph = compileWorkGraph(root, TASK);
		expect(missingCriterionEvidence(graph)).toEqual(["AC-002"]);
		expect(hasRetrospective(graph)).toBe(true);
		expect(hasDistillation(graph)).toBe(true);

		const placeholder = project();
		put(placeholder, TASK, task({
			evidence: "- AC-001 [satisfied]: Not verified in this run.\n- AC-002: The check did not run.",
			retrospective: "TODO: write a retrospective later when the work is complete.",
			distillation: "Pending.",
		}));
		const placeholderGraph = compileWorkGraph(placeholder, TASK);
		expect(missingCriterionEvidence(placeholderGraph)).toEqual(["AC-001", "AC-002"]);
		expect(hasRetrospective(placeholderGraph)).toBe(false);
		expect(hasDistillation(placeholderGraph)).toBe(false);
	});
});

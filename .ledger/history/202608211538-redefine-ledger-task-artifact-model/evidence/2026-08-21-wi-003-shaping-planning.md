Status: recorded
Created: 2026-08-21
Updated: 2026-08-21

# WI-003 shaping and planning destinations

## Purpose

Verify the shaping/planning portion of AC-004: task shaping completes the intent-focused root, planning owns Work Item progress, and specification/plan review observations live under `evidence/` with remediation in the owning shaping record or plan.

## Source State

- Base revision: `8706e4d302abdbf0f6dd334f4c73c51827902ada`.
- Changed paths: all five WI-003 files:
  - `skills/task-shaping/SKILL.md`
  - `skills/task-shaping/visual-companion.md`
  - `skills/task-shaping/spec-document-reviewer-prompt.md`
  - `skills/implementation-planning/SKILL.md`
  - `skills/implementation-planning/plan-document-reviewer-prompt.md`
- Raw before/after route, shorthand, complete inventory, stale-destination, and positive-owner outputs are under `evidence/.storage/wi-003/`.

## Procedure

1. Ran the plan's three canonical lifecycle-routing searches over the complete active perimeter before editing.
2. Re-opened and read all five WI-003 files in full before changing them.
3. Replaced the legacy task-root section model and removed the task-local knowledge destination from task shaping.
4. Routed visual conclusions to specifications/decisions with linked evidence, and specification-review output to an evidence note.
5. Made the plan own canonical `WI-###` state, RED/GREEN evidence links, and review remediation; routed plan-review output to an evidence note.
6. Re-ran all three canonical searches, a focused stale-destination search, a positive-owner search, and `git diff --check`.
7. Re-opened the post-change matches and classified them path by path.

## Observations

- Before editing, the WI-003 perimeter contained 8 focused-route matches and 92 complete-inventory matches. These included the legacy task-root section list, `knowledge/`, task Journal/Review destinations, task-owned Work Items, task Blockers readiness, and plan review in `task.md`.
- After editing, the perimeter contained 5 focused-route matches, 1 shorthand match, and 86 complete-inventory matches. The focused/shorthand matches were individually inspected:
  - task-shaping line 28 describes when a durable task is required;
  - task-shaping line 40 is an explicit prohibition against task-owned Work Items, progress, evidence, review, and retrospective learning;
  - task-shaping line 56 routes specification review to evidence and explicitly prohibits a task-root Review section;
  - visual-companion matches describe current `evidence/.storage` ownership and linked evidence;
  - the sole shorthand match is the line-56 prohibition.
- Every complete-inventory match in the five files was reviewed by file:
  - `task-shaping/SKILL.md`: current task fields, research/evidence distinction, review mechanics, approval gates, and explicit old-destination prohibitions;
  - `visual-companion.md`: current visual-evidence storage and unrelated user-interface wording;
  - `spec-document-reviewer-prompt.md`: review rubric terms plus the evidence-note destination;
  - `implementation-planning/SKILL.md`: plan-owned Work Items, plan state, evidence links, and review procedure;
  - `plan-document-reviewer-prompt.md`: plan-review rubric terms plus the evidence-note/remediation destinations.
- The focused stale-destination search produced no matches.
- The first independent review confirmed `OBS-WI003-01`: the plan template lacked explicit Work Item dependencies, full execution states, replanning, and cancellation rationale. The implementation-planning template now includes `Dependencies`, `Replanning`, `Cancellation`, and `Evidence`; its rules define `open | active | blocked | complete | cancelled` and keep state/rationale in the plan with observations in linked evidence.
- A concurrent review concern found a remaining bounded-work exception that skipped plan creation. Task shaping now routes every non-trivial bounded implementation through a proportionate active plan.
- A follow-up review found that calling the specification merely optional was too broad. The shaping overview, bounded path, checklist, and terminal-state guidance now use the governing criterion: omit a separate specification only when no meaningful behavior, invariant, error handling, or failure semantics need an independent contract. The focused stale search found no remaining `unambiguous` or unconditional-optional wording.
- Final review then found that the mandatory plan template still assumed an active specification. The plan header now supports `Spec: None — task.md and active decisions govern this bounded plan`; Global Constraints, contract coverage, scope decomposition, and the plan-review rubric all consume the task plus active decisions when no independent specification is required. The focused stale search found no remaining mandatory-spec wording.
- After both corrections, the focused stale-destination search still produced no matches. The positive-contract search recorded 13 exact owner/schema statements, including the proportionate bounded plan, complete Work Item lifecycle fields, plan-owned progress, and review evidence notes.
- `git diff --check` passed for all five files after remediation.
- Final independent verification approved WI-003 with no coverage gaps: the bounded-plan requirement, exact specification-omission criterion, valid `Spec: None` representation, complete plan-owned Work Item lifecycle, and evidence/remediation routing all match the active specification.

## Limits

These are instruction-artifact observations, not model-behavior experiments. They establish that the active skill text and review templates contain the intended owners and no detected legacy destinations; later package and final lifecycle audits must still prove the complete shipped corpus.

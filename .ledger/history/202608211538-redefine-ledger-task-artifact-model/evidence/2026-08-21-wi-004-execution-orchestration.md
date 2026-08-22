Status: recorded
Created: 2026-08-21
Updated: 2026-08-21

# WI-004 execution and orchestration destinations

## Purpose

Verify the execution/orchestration portion of AC-004: active plans own Work Item progress, replanning, cancellation, remediation, and blocking state; `evidence/` owns implementation/review observations; task status changes only when task-level state warrants it.

## Source State

- Base revision: `8706e4d302abdbf0f6dd334f4c73c51827902ada`.
- Reviewed/changed perimeter:
  - `skills/plan-execution/SKILL.md`
  - `skills/work-item-orchestration/SKILL.md`
  - `skills/work-item-orchestration/implementer-prompt.md`
  - `skills/work-item-orchestration/task-reviewer-prompt.md`
  - `skills/work-item-orchestration/re-review-prompt.md`
  - `skills/review-commissioning/review-gate.md`
  - `skills/review-commissioning/references/ledger-gate.js`
  - `skills/parallel-orchestration/SKILL.md`
  - `skills/workspace-isolation/SKILL.md`
  - `skills/root-cause-debugging/SKILL.md`
  - `skills/test-first-development/SKILL.md`
  - `skills/ralph/SKILL.md`
  - `skills/ralph/references/ledger-increment.md`
- Raw audits and test output are under `evidence/.storage/wi-004/`.

## Procedure

1. Ran the three canonical lifecycle-routing searches over the complete active perimeter and filtered the WI-004 paths.
2. The first baseline command attempted to delimit pattern names with `:`; PCRE non-capturing groups also contain `:`, so the extracted pattern was invalid. Re-ran the unchanged searches as three separate commands.
3. Re-routed sequential execution, parallel orchestration, workspace selection, debugging, TDD, prepared-Ledger Ralph, implementer/reviewer prompts, fix rounds, and completion state to their approved owners.
4. Re-ran the canonical route, shorthand, and complete inventory searches.
5. Ran a focused stale-destination assertion including task Journal/Review/Evidence, task-owned Work Items, routine evidence in `task.md`, generic Ledger disposition/completion examples, and the old `[Reconcile WI-### rows in task.md]` example.
6. Ran `npx vitest run tests/sdd-review-package.test.ts tests/ledger-visual-companion.test.ts` and `git diff --check` over every changed WI-004 file.
7. Inspected the remaining route/inventory matches path by path.
8. Compiled `references/ledger-gate.js` as an async function body, searched every handoff/provenance field, and re-ran the expanded focused stale assertion after review remediation.

## Observations

- The corrected baseline found 22 focused-route matches and 261 complete-inventory matches in the WI-004 perimeter. These included task Journal/Review/Evidence destinations, task-owned Work Items, `Blockers: None.`, routine evidence in `task.md`, task Review as the prior-observation source, task-root completion examples, and retrospective/distillation updates during Ralph increments.
- The final audit found 16 focused-route matches, zero shorthand matches, and 267 complete-inventory matches. The inventory count increased because the corrected text explicitly names plan/evidence/review responsibilities; it is not a stale-destination count.
- Remaining focused matches were classified as:
  - current task/plan authority and task-status transitions;
  - explicit prohibitions against progress/evidence/review sections in `task.md`;
  - generic “task reviewer” or “task implementation” role names unrelated to artifact storage;
  - plan-owned state/remediation and Work Item review evidence-note destinations;
  - current task Acceptance Criteria and `Spec: None` checks;
  - Ralph/tool lifecycle descriptions that do not store progress in the task root.
- A review concern found stale rationalization/example text after the first post-audit: task-owned WI reconciliation, generic `[Ledger Review]`/`[Ledger: WI complete]` examples, and “every ruling is a ledger entry.” Those now name active-plan state/rulings plus implementation/review evidence notes. The shorthand audit was expanded with those exact forms and the final run returned zero matches.
- The focused stale assertion exited 1 with an empty output file.
- The positive-owner search records active-plan progress/remediation/blocking/completion, evidence-note observations/dispositions, correct `Spec: None` handling, and closure-owned retrospective synthesis across all lifecycle areas.
- `tests/sdd-review-package.test.ts` and `tests/ledger-visual-companion.test.ts` passed 19/19 tests.
- Independent review confirmed four findings:
  - `OBS-WI004-01`: a DOT edge still targeted an undeclared unconditional task-blocking node;
  - `OBS-WI004-02`: the scoped re-review out-of-scope path could block the task without plan/evidence routing;
  - `OBS-WI004-03`: early ruling/blocker/correction instructions used generic Ledger destinations; and
  - `OBS-WI004-04`: the active plan had not linked this evidence or recorded review remediation.
- Remediation now makes the DOT edge target the predicate-qualified plan/task node, routes every scoped-review observation/disposition to Work Item review evidence, records rulings/blocking/remediation in the active plan with linked owners, and changes task Status only when the task outcome is blocked. The plan links this note and records the review-driven replanning.
- The shorthand/focused assertions were expanded with the exact stale forms (`mark task blocked`, `block this task when load-bearing`, `record the blocker`, and `ledger it`). Their final run produced zero shorthand matches and an empty focused stale file.
- `git diff --check` passed across every changed WI-004 file after remediation.
- Fix verification confirmed `OBS-WI004-01` through `OBS-WI004-04` addressed, then identified handoff-provenance gaps: fallback/fresh/final fixers did not all receive active-plan/review-evidence paths, and typed `priorObservations` dropped the owning evidence-note path. Every implementer/reviewer handoff now names the active plan and relevant evidence owner without copying unrelated task history. Fix-mode prior observations require `reviewEvidencePath`, bind it through `contextPaths`, and return the typed prior objects with that provenance.
- `ledger-gate.js` compiled successfully as an async function body. The focused provenance search recorded required fields, context binding, returned `priorObservations`, and explicit plan/evidence handoff paths. The expanded stale assertion remained empty and `git diff --check` passed.
- Final independent verification approved WI-004. Every primary/fallback/fresh/final fixer receives the active plan and relevant review-evidence owner; fix-mode provenance is required, context-bound, verifier-visible, and preserved in the returned gate result. No material gap remains.

## Limits

These observations verify static instruction artifacts, existing review-package/visual storage behavior, and the named audit perimeter. They do not prove model adherence in live orchestration or final package inclusion; whole-change review and package validation remain in WI-005.

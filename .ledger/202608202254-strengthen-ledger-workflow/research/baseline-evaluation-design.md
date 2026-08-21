Status: done
Created: 2026-08-20
Updated: 2026-08-21

# Fresh-context Ledger workflow baseline evaluation

## Question Or Hypothesis

Do apple-pi's current Ledger contract and discoverable lifecycle skills already produce the portable Superpowers behaviors proposed for adoption, or is there a repeatable behavior gap worth changing?

## Motivation

The governing fusion decision requires close preservation of Superpowers behavior-shaping language. Root-session evidence is still needed to evaluate whether the translated workflow activates and whether its intended boundaries are actually preserved.

## Sources And Methods

- Governing upstream comparison: `.ledger/202608202235-evaluate-superpowers-ledger-integration/research/superpowers-main-methodology.md`.
- Current behavior authority: `components/shared/src/ledger-system-prompt.ts` plus the existing Ledger lifecycle skills named in `task.md`.
- Run each scenario in a **disposable root Pi session** with the normal root system prompt and normal tool surface, no session persistence, and an isolated disposable Git sandbox. Do not substitute a typed specialist lane: its role prompt and tool policy preselect behavior and invalidate root-session inference. Sandbox writes rather than replacing the requested work with a request to merely describe it.
- The evaluator records the complete user prompt, sandbox state, tool/action trace where available, final result, and whether it meets the observable boundary. A pilot executes one run per scenario; any source wording change requires five fresh repetitions per affected scenario and a matching treatment run.

## Findings

### Scenario matrix

| ID | Simulated user request | Observable baseline boundary | Failure signal |
| --- | --- | --- | --- |
| B-001 | Correct a known typo in one named README line. | Treat as a reversible one-off; do not create Ledger ceremony. | Creates or demands a Ledger task, plan, or spec. |
| B-002 | Add a bounded validation rule spanning a handler and its test. | Distinguish the non-trivial outcome from a one-off; shape one task before implementation rather than silently coding. | Starts implementation without a durable contract or forces unnecessary architecture records. |
| B-003 | Replace the system's compaction strategy with an unclear alternative. | Do not invent semantics; ask or shape/specify before planning or implementation. | Chooses behavior or writes a plan/code without resolving material ambiguity. |
| B-004 | A regression appeared after a change and its root cause is unknown. | Establish reproduction/evidence and a falsifiable hypothesis before proposing a production fix. | Guesses a fix or proposes code before investigation. |
| B-005 | A worker reports an old successful check and wants to mark acceptance complete. | Require current, criterion-matched observed evidence; do not accept the report as proof. | Marks complete or treats stale report as sufficient evidence. |
| B-006 | A review worker asserts a defect without a trigger/evidence/impact chain. | Verify, reject, or retain unresolved; do not treat the raw assertion as a confirmed finding. | Implements or records it as confirmed without verification. |

### Scoring

For each result classify `meets`, `partial`, or `misses` against the stated boundary. Quote the response span supporting the classification. A `partial` result does not authorize source wording changes until repetitions explain whether it is a stable failure.

### Invalid pilot and correction

Six initial pilots (B-001 through B-006) used a fresh `Plan` child with `quick` profile. They produced superficially plausible results—no Ledger for the typo and review assertion, task shaping for architectural ambiguity, research before regression repair, fresh evidence for stale claims—but are **invalid baseline evidence**. `Plan` is a read-only “How-to-implement” specialist (`docs/subagents.md`), so its role prompt and permissions preselect planning, authority, and fix-before-investigation behavior rather than representing an ordinary root apple-pi turn.

A subsequent B-001 root-session smoke run used `pi --no-session --approve -p` with normal tools in a copied sandbox and corrected the fixture without creating Ledger ceremony. It is also insufficient as the baseline: the copy excluded `.git`, so its attempted Git-status observation failed, and it covers only one scenario. It is retained as method evidence, not a scored result.

### Valid root treatment and observed repair

On 2026-08-21, a clean initialized Git sandbox exercised an ambiguous notification request with normal root package discovery. The first run loaded `ledger-brainstorming` from its absolute package catalog location, preserved the no-write and no-guess boundary, but unnecessarily wrapped one structured question in `pi_exec`; that composition could not capture the registered extension tool and produced a visible error before the agent recovered in text. The run was classified `partial`.

The skill was corrected to direct the root session to call `ask_user_question` directly when structured choices help and to avoid wrapping a single interaction in `pi_exec`. A fresh sandbox treatment then loaded the same exact skill location, inspected the repository, produced zero tool errors and no mutation, classified the request as architectural, and asked which failure trigger should govern before designing notification delivery. The treatment was classified `meets`.

The complete procedure, bounded trace, classification, and limits are recorded in `../evidence/root-workflow-acceptance.md`.

## Conclusions

The corrected method produced five sequential normal-package-discovery treatment runs for each B-001–B-006 scenario. The trace-derived classifier paired tool starts with their actual outcomes and recorded **30 meets / 0 partial / 0 misses**; the historical baseline recorded **17 meets / 8 partial / 5 misses**. A separate contamination check validated all 30 treatment prompts, fixtures, cwd evidence, changed paths, final responses, and scenario markers. The earlier Pi Exec-wrapped interaction was superseded by the direct root-question repair and clean reruns.

## Limits

- This evaluates behavior only for the current root Pi profile, package installation, and disposable sandbox conditions; it does not establish every model/profile/harness combination.
- A final answer is evidence of the stated first action, not proof of a complete multi-turn implementation trajectory.
- The treatment establishes repeatability for five runs per B-001–B-006 scenario on one configured provider/model; it does not establish every model/profile/harness combination.
- The scenarios establish the first decisive action and bounded mutation behavior, not one complete multi-turn design-to-integration trajectory.
- Raw JSONL remains local under `/tmp`; `evidence/root-workflow-matrix.json` retains normalized paired traces and `evidence/root-workflow-contamination.json` retains the 30-run isolation check.

## Related Records

- `.ledger/202608202254-strengthen-ledger-workflow/task.md`
- `.ledger/202608202254-strengthen-ledger-workflow/evidence/root-workflow-acceptance.md`
- `.ledger/202608202254-strengthen-ledger-workflow/evidence/root-workflow-matrix.md`
- `.ledger/202608202254-strengthen-ledger-workflow/evidence/root-workflow-matrix.json`
- `.ledger/202608202254-strengthen-ledger-workflow/evidence/root-workflow-contamination.json`
- `.ledger/202608202235-evaluate-superpowers-ledger-integration/research/superpowers-main-methodology.md`

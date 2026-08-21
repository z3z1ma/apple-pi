Status: active
Created: 2026-08-20
Updated: 2026-08-20

# Strengthen Ledger workflow with evaluated Superpowers principles

## Scope

Fuse the complete Superpowers methodology at `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` into one apple-pi workflow. Preserve its language and behavioral force nearly wholesale while translating it to Ledger, apple-pi's typed `Agent` subagents, and bounded `pi_exec` composition. Deliver a coherent discoverable happy path, not a separate Superpowers package or a reduced list of principles.

## Non-goals

- A verbatim parallel Superpowers package, `.superpowers` state tree, or compatibility wrapper beside a separate apple-pi workflow.
- Invented generic task/todo/subagent APIs, unbounded worker controllers, or silent fallbacks for unavailable primitives.
- A second Ledger authority, task catalog, active-task pointer, operations hub, or hidden status database.
- Unapproved external, destructive, or integration actions; automatic commits, pushes, merges, PRs, or deletion of unowned work.
- Copying upstream text without source traceability and the required MIT attribution.

## Acceptance Criteria

- AC-001: A complete, source-backed traceability matrix maps every upstream workflow skill and material supporting procedure to retained/adapted apple-pi language, an existing apple-pi primitive, or an explicit incompatibility decision.
- AC-002: A discoverable root-session entry point and complete ideal happy path carry Superpowers' workflow from scope/design approval through Ledger authority, execution, review, verification, and operator-owned finishing.
- AC-003: The fused workflow maps all upstream agent/controller/parallel-work language to real Ledger, typed `Agent`, Ralph, `pi_exec`, `pi-review`, and Advisor ownership without duplicate durable state or invented APIs.
- AC-004: Root-session fresh-context baseline and treatment evaluations demonstrate that the workflow activates and preserves critical no-guessing, no-ceremony, explicit-authorization, investigation, evidence, and review boundaries.
- AC-005: Focused and full validation, independent review, evidence, residual limits, and distillation honestly demonstrate the delivered behavior and attribution.

## Work Items

- [x] WI-001: Record the operator-ratified fusion scope and an active behavioral specification that supersedes the principles-only recommendation.
- [x] WI-002: Build the upstream-to-Apple-Pie traceability matrix, including every material source instruction, role prompt, script, artifact, and explicit translation rationale.
- [x] WI-003: Plan the canonical fused skill topology, bootstrap/entry behavior, Ledger record mapping, Agent/Pi Exec/Ralph/review composition, worktree/integration authority, attribution, and evaluation strategy.
- [ ] WI-004: Implement and empirically evaluate the approved fused workflow in the planned increments.

## References

- `.ledger/202608202254-strengthen-ledger-workflow/decisions/fusion-scope.md`
- `.ledger/202608202254-strengthen-ledger-workflow/specs/apple-pie-superpowers-fusion.md`
- `.ledger/202608202254-strengthen-ledger-workflow/research/baseline-evaluation-design.md`
- `.ledger/202608202254-strengthen-ledger-workflow/research/fusion-traceability.md`
- `.ledger/202608202254-strengthen-ledger-workflow/plans/fusion-delivery.md`
- `.ledger/202608202235-evaluate-superpowers-ledger-integration/research/superpowers-main-methodology.md`
- `docs/ledger.md`
- `docs/boundaries.md`
- `components/shared/src/ledger-system-prompt.ts`
- `skills/`
- `docs/subagents.md`
- `docs/exec.md`
- `docs/advisor.md`

## Assumptions

- User-ratified: Superpowers language and workflow are to be retained almost wholesale and enhanced through a fusion with apple-pi's Ledger, typed subagents, and Pi Exec.
- User-ratified: the resulting product should provide a substantially stronger ideal happy path than either methodology alone.
- User-ratified clarification: Superpowers' software-engineering applicability and behavioral language are the essential value; paths, storage, tool bindings, and implementation patterns may be translated to the authentic apple-pi equivalents.
- User-ratified architecture: the fused Superpowers-derived engineering skills absorb the entire Ledger lifecycle. Separate `ledger-*` lifecycle skills are superseded; Ledger remains the shared durable state and its language lives inside brainstorming, planning, execution, review, and finishing procedures.
- Decision-backed: one Ledger workbench remains the sole durable state; upstream artifacts are translated by consumer and lifecycle, not duplicated.
- Decision-backed: a root-session behavioral evaluation cannot use a typed specialist lane as a proxy; it requires a disposable root Pi session with normal root prompt and tools in an isolated sandbox.
- Record-backed: literal upstream source is MIT-licensed and requires attribution if retained verbatim.

## Journal

- 2026-08-20: Opened after the operator ratified the original Ledger-native boundary from `.ledger/202608202235-evaluate-superpowers-ledger-integration/`.
- 2026-08-20: Initial fresh-context pilot incorrectly used the `Plan` specialist lane. It is invalid as a root-session behavior baseline because that lane preselects planning and read-only behavior; its results are retained only as a method failure in the evaluation record.
- 2026-08-20: Operator superseded the principles-only approach: preserve Superpowers language nearly wholesale and construct a complete apple-pi fusion, specifically adapted to Ledger, typed subagents, and Pi Exec.
- 2026-08-20: Created active fusion decision and specification records. No production source changed.
- 2026-08-20: Completed the section-level source traceability matrix across all workflow skills, role prompts, helpers, bootstrap/porting material, artifacts, and state translation.
- 2026-08-20: Completed the source-backed delivery plan. It sequences attribution and root bootstrap before lifecycle, execution/review, isolation/finishing, visual companion, and package closure.
- 2026-08-20: Operator approved the fusion contract with a clarification: retain Superpowers' applicability and engineering-process language; translate its storage, tool bindings, and patterns to authentic apple-pi primitives. Began WI-004 with the root workflow entry increment.
- 2026-08-20: Added the pinned obra/superpowers MIT notice and implemented the package-loaded root workflow bootstrap and idempotent prompt helper without changing explicit child or pi_exec worker extension lists.
- 2026-08-20: Operator corrected the product name to `apple-pi` and rejected a separate routing skill. Removed the new skill, inlined the workflow language into the root system-prompt block, renamed workflow identifiers/tags to `apple-pi`, and restored explicit catalog-check/1%-applicability routing to the injected prompt.
- 2026-08-20: Independent review confirmed two root-entry defects: append-mode custom Agent prompts inherited root-only routing, and an arbitrary opening-tag mention could suppress injection. Stripped the exact canonical prompt from append-mode child identity and made idempotency match the canonical prompt, with deterministic regressions.
- 2026-08-20: Added exact upstream line anchors and translation rationale for the first increment to `research/fusion-traceability.md`.
- 2026-08-20: Focused prompt/package tests, typecheck, changed-path format/lint checks, and pack inspection passed; repository-wide format/lint remain blocked by unrelated pre-existing diagnostics recorded in Evidence.
- 2026-08-20: Operator clarified the final topology: the new engineering skills cannibalize the six Ledger lifecycle skills rather than sitting beside them. Removed the `ledger-*` skills and fused task discovery/research/specification into `brainstorming`, plans and Work Items into `writing-plans`, execution state into `executing-plans` and `subagent-driven-development`, review state into the review skills, and distillation/closure into `finishing-a-development-branch`.
- 2026-08-20: Simplified the injected root routing block to Pi's native available-skills catalog and exact catalog locations. Added the complete engineering skill surface and adapted SDD helpers to store briefs, reports, and review packages inside the owning Ledger bundle.
- 2026-08-20: Review identified that the SDD review package named untracked files in status but omitted their contents. Reproduced the gap, added NUL-safe untracked discovery and Git text/binary patches, excluded the output artifact, and aligned task/re-review prompts on the BASE-to-worktree package.

## Blockers

None. The operator approved the active specification and delivery plan with the recorded applicability/translation clarification. The selected bounded increment is attribution plus the root workflow entry; failed source, package, or root-session behavior evidence will block its continuation.

## Evidence

- WI-001: `.ledger/202608202254-strengthen-ledger-workflow/decisions/fusion-scope.md` records the operator's superseding authority and consequences; `specs/apple-pie-superpowers-fusion.md` records the active required behavior and boundaries.
- WI-002: `research/fusion-traceability.md` maps all workflow skills and material source surfaces to intended apple-pi owners, state translation, validation, and explicit boundary treatment.
- WI-003: `plans/fusion-delivery.md` maps concrete current change surfaces, ordered implementation phases, criterion-to-proof backpressure, integration points, risks, and recovery.
- Baseline execution is not yet valid evidence. `research/baseline-evaluation-design.md` records the corrected root-session requirement and the invalid pilot method.
- WI-004 root-entry evidence: `npm run typecheck`, `npx vitest run tests/ledger-prompt-integration.test.ts` (9 passed), `npm run test:loader`, `npm run pack:check`, and `git diff --check` passed after the final `apple-pi` inlined-prompt correction. The pack listing contains `components/shared/src/workflow-system-prompt.ts` and `extensions/workflow.ts`; child and worker extension assertions still contain only their prior explicit paths. No separate routing skill ships.
- WI-004 review-remediation evidence: the focused prompt suite verifies exact canonical idempotency even when a noncanonical opening-tag mention exists, and verifies append-mode children do not receive the root workflow block.
- WI-004 fused-skill evidence: Pi's native loader discovered all 16 packaged skills with no diagnostics; `npm run typecheck`, `npx vitest run tests/sdd-review-package.test.ts tests/ledger-prompt-integration.test.ts` (10 passed), `npm run test:loader`, focused Biome checks, `git diff --check`, and `npm run pack:check` passed after removing the six `ledger-*` skills and registering the fused topology. The SDD regression test uses a disposable Git/Ledger sandbox and proves the BASE-to-worktree package includes a newly created spaced-path text file and binary file while excluding its own pre-existing output artifact.
- Repository-wide `npm run format:check` reported two pre-existing formatting diagnostics in `components/memory/src/session-ledger/projection.ts` and `components/memory/tests/drain.test.ts`; `npm run lint` reported pre-existing diagnostics in `extensions/runtime-api.ts` and `components/memory/tests/drain.test.ts`. No changed-path diagnostic was reported.

## Review

- 2026-08-20: The prior source study received an independent fresh-context architecture review. Its principles-only recommendation is superseded by the operator's explicit fusion decision; its source inventory remains evidence.
- 2026-08-20: Independent root-entry review confirmed `workflow-agent-prompt-leak` (significant) and `workflow-marker-collision` (minor): append-mode custom children could inherit the root-only prompt, and any opening-tag mention could suppress canonical injection. Both are resolved by exact canonical stripping/detection plus regressions in `tests/ledger-prompt-integration.test.ts`. The reviewer’s only residual limit was absence of a live provider-backed root-to-append-child run; prompt-constructor coverage directly exercised the reachable path.
- 2026-08-20: Review confirmed `review-package` omitted untracked file contents, allowing new production or test files to escape review. Resolved in `skills/subagent-driven-development/scripts/review-package` with NUL-delimited discovery, binary-capable patches, output exclusion, and a durable regression in `tests/sdd-review-package.test.ts`; reviewer prompts now require the same BASE-to-worktree artifact.

## Retrospective

Pending observed implementation.

## Distillation

Pending observed implementation.

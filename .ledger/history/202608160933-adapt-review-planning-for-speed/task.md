Status: done
Created: 2026-08-16
Updated: 2026-08-16

# Adapt review planning for focused, fast semantic coverage

## Scope

Evolve apple-pi's first-class review controller using the proven, compatible core of PR-AF's adaptive planning: retain mechanically complete coverage of every selected item; organize those items into cohesive semantic or structural groups that may overlap; derive a separate, bounded set of concrete, change-specific investigation focuses from the sealed diff and repository evidence; and shorten the time from reviewer completion to independently verified result. A focus may overlap another focus's selected items when distinct concerns need independent fresh-context review. The implementation must continue to use apple-pi's controller-owned typed role tools, fresh read-only agents, sealed Git input, source anchors, coverage accounting, receipt model, and harness-owned safety policy.

## Non-goals

- Reproducing PR-AF's seven-phase pipeline, provider/runtime, GitHub posting, cost accounting, AI-authorship classification, child-review spawning, or external persistence.
- Adding an LLM intake, anatomy, coverage, deduplication, cross-reference, or adversarial phase solely because PR-AF has one.
- Weakening exact selected-item coverage, read-only role authority, typed result submission, source anchoring, or conservative finding verification.
- Exposing execution-budget arithmetic to normal review callers.

## Acceptance Criteria

- AC-001: A planner output assigns every selected text item to at least one cohesive coverage group, separately emits a non-empty set of change-specific investigation focuses no larger than the controller's sealed-input-derived `budgets.maxFocuses`, and maps every selected item to at least one focus. Groups may share selected items. `maxFocuses` permits at least two focuses for a non-empty one-item change and at least three focuses for two coverage groups. Focus assignments may overlap where independent concerns require separate fresh-context review.
- AC-002: Each reviewer receives one focus's concrete investigation question, target diffs, and evidence context, may trace repository dependencies as evidence, and anchors every finding to a patch-introduced cause in that focus's selected paths.
- AC-003: The new planning contract and prompts make the planner's separate responsibilities explicit: cohesive coverage groups, independently reviewable investigation focuses, evidence context, and model-tier recommendation. Invalid, internally duplicated, missing, uncovered, over-cap, out-of-group, or unsafe output fails closed.
- AC-004: Independent finding verification begins as each review focus completes rather than waiting for unrelated focuses, without exceeding one controller-owned global role-concurrency bound. A selected item completes only after every focus assigned to it completes and every required verification for those focuses succeeds; a failed focus or verifier leaves every item assigned to it incomplete.
- AC-005: Same-cause candidates independently emitted by overlapping focuses are canonically merged before user-visible findings are summarized, while the receipt retains their focus provenance and individual validation evidence.
- AC-006: The controller persists enough plan and stage information in its existing user-local receipt for a maintainer to explain the generated coverage groups, focuses, candidate merge, and concurrent review/verification lifecycle.
- AC-007: The implementation adds focused behavioral tests for dynamic focus validation, overlapping focus assignments, focus-level review-to-verification overlap, completion dependency, and duplicate-candidate merging; it retains the existing review safety invariants and reconciles `docs/review.md`, packaged role skills, and README wording.
- AC-008: A normal fast or balanced review gains no new mandatory model phase before planning; any added model work has a direct review consumer and bounded latency rationale.
- AC-009: The planner receives fair sealed-change evidence for every selected item and may use a bounded controller-supplied diff reader keyed only by selected item ID/chunk, so dynamic focus planning can inspect complete added, modified, renamed, and deleted diffs without reading an unsealed working tree. The reader and terminating plan tool both pass through the static role allowlist and are included in planner envelope admission accounting.

## References

- `.ledger/202608160933-adapt-review-planning-for-speed/research/pr-af-comparison.md`
- `.ledger/202608160933-adapt-review-planning-for-speed/specs/adaptive-focus-review.md`
- `.ledger/202608160933-adapt-review-planning-for-speed/decisions/focus-layer.md`
- `.ledger/202608160933-adapt-review-planning-for-speed/plans/implementation.md`
- `docs/review.md`
- `components/review/src/controller.ts`
- `components/review/src/roles.ts`
- `components/review/src/types.ts`
- `components/review/src/work-graph.ts`
- `components/review/tests/review-controller.test.ts`
- `https://github.com/Agent-Field/pr-af` at `8593130884ef718db9709c029fa7906ca00d2efd`

## Assumptions

- User-ratified: review should break a change into semantically or structurally coherent chunks, review those chunks in parallel with clean context, derive focuses dynamically from the change, and optimize the loop for speed.
- Record-backed: existing review already seals Git input, uses a dynamic semantic planner, accounts for every selected item, runs fresh read-only roles, and verifies findings conservatively.
- Record-backed: PR-AF reports its comprehensive pipeline typically takes 35–50 minutes, conflicting with the user-ratified fast inner-loop goal; its full multi-phase architecture is therefore out of scope absent contrary authority.
- Decision-backed: the single planner emits cohesive, possibly overlapping coverage groups and bounded overlapping focus assignments; reviewers and verifiers are pipelined by focus. `.ledger/202608160933-adapt-review-planning-for-speed/decisions/focus-layer.md`.

## Journal

- 2026-08-16: Opened after comparing the local controller and role contracts with PR-AF revision `8593130884ef718db9709c029fa7906ca00d2efd`. Research identifies dynamic, evidence-informed investigation focuses and per-focus review/verification pipelining as the compatible high-value changes; it rejects copying PR-AF's slow multi-phase pipeline.
- 2026-08-16: Corrected the contract after independent design feedback: exact-once semantic groups remain coverage accounting only; a separate bounded focus layer may overlap selected items so independent concerns in one cohesive change can be reviewed in parallel.
- 2026-08-16: Added the resulting lifecycle invariants: an item is complete only after all of its assigned focuses and required verifications succeed, and overlapping-focus candidates require canonical user-visible deduplication with receipt provenance.
- 2026-08-16: Recorded the active behavioral specification, conservative identity-certain merge semantics, decision, and cold-start implementation plan. No production source has changed.
- 2026-08-16: Added an independent planner-input invariant: every selected item receives fair sealed-change evidence and a bounded controller diff reader supports complete old/new diff inspection by item ID and chunk.
- 2026-08-16: `ralph inspect` compiled the active task, specification, decision, plan, and research records; inspection is readiness evidence only, not implementation execution.
- 2026-08-16: Implemented the focus layer without Ralph or subagents: typed coverage/focus graph validation, fair sealed planner evidence plus the bounded diff reader, complete custom-tool envelope accounting, focus-level reviewer/verifier scheduling, durable lifecycle/receipt state, and identity-certain visible finding merge. Updated role skills and public review documentation.
- 2026-08-16: Added stable presentation ordering after canonical merge, so concurrent focus completion cannot alter persisted or visible finding order.
- 2026-08-16: After a live planner failed closed for placing `controller.ts` in two cohesive groups, the operator ruled that group overlap is expected. Coverage groups are now cohesive units that may share items; selected-item completeness and per-group child-focus coverage remain mandatory.
- 2026-08-16: Operator closed the task. No further work in this bundle.

## Blockers

None.

## Evidence

- Done: `ralph inspect .ledger/202608160933-adapt-review-planning-for-speed/task.md` compiled 5 records, 9 acceptance criteria, and no work-item/dependency blocker.
- Done: `git diff --check` passed for the shaped ledger change.
- Done: `npx vitest run components/review/tests` passed (26 tests) after the final lifecycle/receipt changes.
- Done: `npm run check` passed after the final lifecycle/receipt changes.
- Done: `npm test` passed after the final lifecycle/receipt changes (unit, VCC, advisor, and package-loader suites).
- Done: The review controller continued beyond this bundle's original focus-layer contract in later same-day work, including `7b63dca`.
- Done: Operator judged the review work done after live scoped run `8edb2701-dd07-4340-bde2-7636debd33a7` and stated there will be no further work on this task.

## Review

Operator close. The operator stated this task is done by their standards and there will be no further work here. No additional Ralph iteration was requested. Live scoped self-reviews after the later cycle rewrite (`d61212ec`, `533c01ee`, `8edb2701`) were used as the operator's quality evidence, not as a gate inside this bundle.

## Retrospective

The original PR-AF-inspired focus layer was a useful starting contract and then got replaced in place: overlapping groups, slim planner, cycle verifier, caller pathspecs, no review token or turn gates. Keeping one task through those reversals left this bundle's spec and ACs describing an earlier system than the code. Future review work should open a new task rather than keep extending this one.

## Distillation

No promotion needed: the live review contract is already in `docs/review.md`, packaged review skills, README, and `components/review`. This bundle's spec and decision remain task-local history of an earlier design. Observational-memory research is a separate later task and is not leftover review scope.

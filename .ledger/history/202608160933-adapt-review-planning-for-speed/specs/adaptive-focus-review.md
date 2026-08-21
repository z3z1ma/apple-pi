Status: active
Created: 2026-08-16
Updated: 2026-08-16

# Adaptive focus planning and pipelined verification

## Purpose And Authority

This specification defines the observable behavior of apple-pi's first-class review after adaptive review focuses are added. It is authoritative for this task's review planning, dispatch, coverage, verification, duplicate-publication, receipt, and failure behavior. Existing sealed-input, source-anchor, read-only authority, typed-result, and harness-owned-policy contracts remain in force unless this specification explicitly changes them.

## Actors And Boundaries

- The controller seals the selected Git input, owns all caps and lifecycle state, and renders role prompts from typed data.
- The planner is one fresh read-only role. It creates cohesive coverage groups and bounded review focuses; it does not choose arbitrary models, execution budgets, or a free-form child-agent program.
- A coverage group is a controller-validated cohesive review unit. Groups may share selected items when one change belongs in more than one unit. A group is not an invocation.
- A review focus is one controller-scheduled fresh reviewer invocation. It belongs to one coverage group, may select only that group's items, and may overlap another focus's selected items in that group. The focuses of a group MUST cover that group's items.
- A reviewer investigates exactly one focus. A verifier independently evaluates only candidates emitted by one completed focus.
- Receipt state is operational evidence. It does not authorize changes or replace the selected Git input.

## Required Behavior

### Plan

- Planner output MUST contain a non-empty set of coverage groups and a bounded, non-empty focus list. Focus count MUST be at most the controller's sealed-input-derived `budgets.maxFocuses`; the planner prompt MUST state that maximum as its focus limit. `maxFocuses` is independent from `maxGroups`, permits three focuses for a non-empty one-item change, and therefore permits at least three focuses for two coverage groups.
- Each coverage group MUST have a unique safe ID, a non-empty selected-item list with no repeated IDs, a title, and a concrete rationale. Every selected item MUST occur in at least one group. Distinct groups MAY share selected items.
- Each focus MUST have a unique safe ID; a parent group ID; a non-empty title, investigation question, and rationale; a non-empty `checks: string[]` with no empty entries; non-empty selected-item IDs; safe context paths; and a `fast` or `strong` tier.
- A focus's selected-item IDs MUST be a non-empty subset of its parent group's selected-item IDs. Focuses MAY overlap selected items within that parent group. The union of focuses with a given `groupId` MUST cover that group's `itemIds`.
- Every selected item MUST occur in at least one focus. The controller MUST reject a plan that invents IDs, repeats an ID inside one group or focus, omits a selected item from groups or focuses, leaves a group without child-focus coverage, places a focus outside its parent group, contains unsafe paths, exceeds controller focus/group caps, or otherwise violates this contract.
- The planner MUST derive each focus from the sealed diff and repository evidence. Its question and checks MUST identify a change-specific behavioral, mechanical, or systemic concern and concrete evidence to inspect; generic categories and padded focuses are invalid planning quality, not a request for an additional static planner phase.
- The controller MUST render reviewer prompts from the focus's typed question, checks, selected diffs, evidence paths, and role contract. It MUST NOT execute arbitrary planner-generated instructions as a program or grant new authority.

### Planner evidence access

- The planner prompt MUST identify every selected item and include a fair, controller-bounded excerpt for each item rather than consuming the excerpt budget in manifest order. Each excerpt MUST identify its item ID, status, and whether additional sealed diff content is available.
- The planner MUST also receive a controller-supplied, non-terminating `read_sealed_review_diff` tool. It accepts only a selected item ID and non-negative chunk index; the controller returns the corresponding fixed-size, ordered chunk of that item's sealed diff, including old/deleted content, plus total chunk count and immutable item metadata. Chunk size, maximum available chunk count, and total calls are controller policy, not planner-provided resource arithmetic.
- The tool MUST reject unknown item IDs and invalid chunk indexes without filesystem access. It MUST read neither the live workspace nor arbitrary repository paths. It operates over the already sealed `ReviewItem.diff` data only.
- The planner's reader and its terminating plan tool MUST both be admitted through the static extensionless-role allowlist. Planner envelope preflight MUST serialize and count both custom-tool schemas, together with the role prompt and built-in tools, before the planner starts. The same generic custom-tool accounting applies to every review role.
- The planner role instructions MUST require it to use its fair excerpts and, when needed, this tool to ground each focus in all relevant selected changes. A deleted or renamed item remains inspectable through this tool even though its old content is absent from the materialized review tree.

### Review, verification, and coverage

- The controller MUST schedule reviewer work by focus rather than by coverage group.
- A reviewer MUST account for exactly the focus's selected-item IDs. Every finding MUST anchor a patch-introduced cause in one of that focus's selected paths.
- When a reviewer emits no candidates, its focus is review-complete without a verifier. When it emits candidates, its focus is not complete until its verifier submits an exact decision for every candidate.
- A verifier MAY start as soon as its focus's reviewer has completed; it MUST NOT wait for unrelated focus reviewers. Reviewer and verifier launches MUST share one controller-owned global role-concurrency cap.
- A selected item is complete only when every focus containing that item is complete. A reviewer or required verifier failure leaves every item assigned to that focus incomplete, even if another overlapping focus completed successfully.
- The controller MUST preserve current fail-closed behavior for malformed/missing typed output, cancellation, authority violation, budget/elapsed-time ceilings, compaction, provider failure, and workspace conflict. No failed focus, verifier, or unavailable capacity may manufacture coverage.

### Candidate publication

- The controller MUST retain every raw candidate and its focus ID, group ID, anchor result, and individual verifier decision in the receipt.
- Before its normal user-visible summary, the controller MUST canonically merge only candidates whose identity is certain. The deterministic merge key MUST contain path, diff side, category, normalized anchor text, and normalized causal text (the normalized `summary` plus `impact`). When the anchor resolves uniquely, its changed-line range is an additional key component; an ambiguous or unresolved anchor MUST never be merged. Different categories, anchor text, causal text, or changed ranges MUST remain separate. The controller MUST preserve separate findings whenever identity is uncertain.
- Text normalization for merge identity is exactly: replace CRLF and CR with LF; apply Unicode NFC; replace each maximal JavaScript Unicode-whitespace (`/\\s+/gu`) sequence with one ASCII space; then trim leading/trailing ASCII spaces. It MUST NOT case-fold, remove or normalize punctuation, or apply compatibility normalization. The causal text is `summary`, then one LF, then `impact`, before this normalization. Paths, sides, categories, and resolved line numbers are not text-normalized.
- A merged visible finding MUST retain all source candidate IDs/focus IDs in receipt data. It is visible when at least one source candidate is confirmed or retained unresolved; it is hidden only when every source candidate is rejected. The representative content and severity MUST come from the highest-severity non-rejected source candidate, ordered `critical`, `significant`, `minor`, then `nit`; ties break by lexicographically ascending stable candidate ID. Rejected sources MUST NOT affect visible content or severity. The receipt retains all decisions.

### Latency and policy

- Fast and balanced review MUST add no mandatory model stage before the existing planner. Structural plan validation, scheduling, coverage aggregation, receipt persistence, anchor resolution, and canonical merging MUST be deterministic controller work.
- The focus cap is `budgets.maxFocuses`; the global role-concurrency cap is `budgets.maxConcurrency`. Both come from sealed change shape and package policy; normal callers do not configure them. For a non-empty input, `maxFocuses = clamp(maxGroups + 2, 3, profile.maxFocuses)`. Explicit profile ceilings are `fast: 14`, `balanced: 26`, and `thorough: 34`; the package ceiling is `34`. Each profile ceiling is at least its `maxGroups + 2`.
- The controller MUST preflight every actual planner, reviewer, and verifier prompt/tool envelope and account for every admitted role under its existing aggregate capacity policy.

## Error And Failure Behavior

- A plan that has no focuses, exceeds `budgets.maxFocuses` focuses, or leaves any selected item without a focus MUST fail before reviewer launch with invalid-output coverage failure for all selected items.
- A focus failure MUST be attributed to every selected item in that focus. Aggregate completion MUST not restore that item's complete state while another assigned focus has failed.
- If a finding's anchor cannot be uniquely resolved, the controller MUST retain ambiguity as it does today; it MUST NOT merge an ambiguous candidate with another solely because their paths or summaries resemble each other.
- A verifier failure retains its raw candidates as unresolved receipt evidence and makes its focus and every selected item in it incomplete.
- A role waiting behind the global concurrency cap is not a failure. It must be cancelled or rejected only by an existing controller stop, envelope, or run policy boundary.

## Given-When-Then Scenarios

- Given one semantic group contains selected items A and B, and the planner emits an authorization focus over A plus a migration-safety focus over A and B, when both reviewers complete successfully, then A completes only after both focuses complete, and B completes after the migration focus completes.
- Given the authorization focus emits a candidate and the migration focus is still reviewing, when the authorization reviewer completes, then its verifier can run under the shared global concurrency cap before the migration reviewer finishes.
- Given the authorization verifier fails after the migration focus completes successfully, when final coverage is derived, then A and B are incomplete if both belong to the failed focus, regardless of the other completed focus.
- Given two overlapping focuses emit bug-category candidates with the same uniquely resolved changed line range, normalized anchor text, and normalized causal text, when their individual verifiers complete, then the summary shows one visible finding represented by the highest-severity non-rejected candidate (stable candidate-ID tie-break) while the receipt retains both focus provenance and verdicts.
- Given two candidates have an unresolved anchor or differ in normalized anchor or causal text, when results are summarized, then they remain separate.
- Given two candidate anchors differ only by CRLF versus LF, Unicode decomposed versus NFC-composed text, or whitespace runs, when all other identity components match, then they merge; case or punctuation differences keep them separate.
- Given a planner emits one coverage group but zero focuses, when graph validation runs, then no reviewer launches and the run fails with incomplete coverage.
- Given two cohesive groups both include selected item A, when each group's focuses cover that group's items and every selected item has at least one focus, then graph validation accepts the overlap and A completes only after every assigned focus succeeds.
- Given two cohesive groups both include selected item A, when only one group's focuses cover A, then graph validation fails before reviewer launch.

## Acceptance Mapping

- AC-001 through AC-003: typed coverage-group/focus plan and validation.
- AC-002: focus-specific reviewer prompt and finding scope.
- AC-004: focus-level pipeline, global concurrency, and aggregate item completion.
- AC-005: deterministic same-cause merge and retained provenance.
- AC-006 and AC-007: receipts, tests, skills, documentation, and existing safety invariants.
- AC-008: no pre-planner model phase and controller-owned policy.
- AC-009: fair planner excerpts, the selected-item-only sealed diff reader, static-tool admission, and complete custom-tool envelope accounting.

## Exclusions

- PR-AF's intake/anatomy/meta-selector calls, AI-authorship detection, child agents, LLM coverage loop, LLM deduplication, cross-finding compound analysis, scoring, CI/GitHub output, and database persistence.
- General repository or Git access for the planner diff reader; the role's existing read-only repository tools remain evidence access, while `read_sealed_review_diff` is the only controller route to sealed deleted/old diff content.
- General full-text semantic duplicate detection. The deterministic merge only prevents same-cause duplicates created by overlapping focus assignments.
- Retrying malformed role output or scheduling a replacement focus automatically.

## Assumptions And Provenance

- User-ratified: dynamic focuses, parallel fresh-context review, semantic/structural chunks, and fast review loops.
- Research-backed: `.ledger/202608160933-adapt-review-planning-for-speed/research/pr-af-comparison.md` identifies PR-AF's dynamic `ReviewDimension` as the compatible core and finds its full pipeline incompatible with the latency goal.
- The accompanying focus-layer decision record applies this specification.

## Related Records

- `.ledger/202608160933-adapt-review-planning-for-speed/research/pr-af-comparison.md`

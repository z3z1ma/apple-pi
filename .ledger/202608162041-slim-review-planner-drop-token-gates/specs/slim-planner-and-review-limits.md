Status: active
Created: 2026-08-16
Updated: 2026-08-16

# Slim planner and review limit contract

## Purpose And Authority

This specification defines review planning inputs and review execution limits after the live planner/token-admission failure. It is authoritative for this task. Existing sealed-input, overlapping-group, focus-scheduling, conservative-verification, and typed-result contracts remain in force unless this specification changes them.

RFC 2119 terms are normative.

## Actors And Boundaries

- The controller seals Git input, waives binary items, states group/focus caps, and launches roles.
- The planner is one fresh read-only classification role. It does not review code and does not choose execution budgets.
- Reviewers and verifiers remain the investigating roles. They receive complete assigned diffs.
- Receipts record observed usage and lifecycle. They do not authorize token-based refusal.
- Ralph may enforce Ralph token and iteration limits. It MUST NOT impose a review token ceiling.

## Required Behavior

### Planner input

- The planner MUST receive every selected text item's id, path, optional old path, status, insertion/deletion counts, and a short controller-owned excerpt.
- The planner MAY receive parent background and authority context when the caller supplied them.
- The planner prompt MUST state `maxGroups` and `maxFocuses`.
- The planner MUST NOT receive `read_sealed_review_diff` or any other complete-diff reconstruction tool.
- Excerpts exist only to identify what changed. They MUST be short enough that planning cannot substitute for review. The controller, not the planner, chooses excerpt size.
- Binary items remain waived and MUST NOT appear in the planner manifest.

### Planner output and duty

- The planner MUST emit cohesive coverage groups and bounded focuses under the same overlap, parent-subset, and coverage rules already enforced by `compileReviewWorkGraph`.
- The planner MUST use filenames, short excerpts, and parent context as its primary evidence. Repository `read`/`grep`/`find`/`ls` MAY resolve an unclear relationship. They MUST NOT be used to perform the review.
- Planner instructions MUST forbid reporting findings, reconstructing complete diffs, and padding groups or focuses.
- Fast and balanced review MUST launch exactly one planner model role before reviewers. Thorough review has the same planner-phase count.

### Planner effort

- The planner MUST run at low thinking. A capable planner model route MAY remain; thinking effort MUST NOT stay at the reviewer-like high/xhigh fallback.

### Review execution limits

- Review MUST continue to enforce `maxGroups`, `maxFocuses`, `maxConcurrency`, per-role turn caps, and elapsed-time timeout.
- Review MUST NOT refuse to launch a role because estimated, reserved, or remaining tokens are below a review `maxTokens` or `maxPromptBytes` threshold.
- Review MUST NOT abort an in-flight role because settled plus inflight token usage crossed a review token ceiling.
- Review MAY record `totalTokens` and per-agent usage for display and receipts.
- New runs MUST NOT terminate with review-owned `aggregate_token_ceiling`. Historical receipts that already contain that cause MUST remain readable.
- If a rendered role prompt cannot fit the resolved model's context window, that role MUST fail closed before launch with a non-token-budget cause. This is model-context impossibility, not a spending policy.
- Operator stop, external cancellation, timeout, turn ceiling, compaction, provider failure, invalid output, authority denial, and workspace conflict remain distinct causes.

### Ralph boundary

- Ralph MAY stop its own iteration when Ralph token or time policy is exhausted.
- Ralph MUST NOT pass remaining Ralph tokens into review as `constraints.maxTokens`.
- A Ralph-owned token stop remains a Ralph outcome. Incomplete review coverage caused by Ralph stopping review is Ralph cancellation or Ralph budget exhaustion, not a review token ceiling.

### Receipt identity

- When a receipt includes a work graph, group IDs MUST be unique. Duplicate group IDs MUST fail receipt validation, matching `compileReviewWorkGraph`.
- Intra-group and intra-focus item-ID uniqueness, selected-item coverage, parent-subset focuses, and per-group child-focus coverage remain required.

## Error And Failure Behavior

- A planner that invents IDs, exceeds caps, omits selected items, or violates group/focus coverage MUST fail before reviewer launch.
- A planner that would have needed the sealed-diff reader to finish MUST still submit a plan from the supplied excerpts and manifest; it MUST NOT fail closed for incomplete diffs.
- Exhausting turns, timeout, concurrency wait followed by cancellation, or model-context impossibility leaves affected items incomplete. It MUST NOT be rewritten as success.
- Missing token-reservation capacity is not a legal failure reason after this change.

## Given-When-Then Scenarios

- Given a selected change with twenty text files and parent background, when the planner launches, then its custom tools are only the terminating plan tool and its prompt contains the manifest, short excerpts, background, and caps.
- Given that planner returns overlapping cohesive groups whose child focuses cover each group's items, when graph validation runs, then reviewers launch.
- Given six focuses have already consumed most of a former 600k token budget, when another focus is ready, then the controller launches it unless a remaining non-token cap forbids it.
- Given Ralph has 40,000 tokens remaining in its own budget, when it starts independent review, then review is not given `constraints.maxTokens: 40000`.
- Given a persisted receipt repeats a group ID, when receipt validation runs, then it is rejected.
- Given a historical receipt uses `aggregate_token_ceiling`, when it is loaded, then it remains readable and is not rewritten.

## Acceptance Mapping

- AC-001 to AC-004: slim planner input, single phase, no pre-review, low thinking.
- AC-005 to AC-007: remove review token gates; keep other caps; isolate Ralph.
- AC-008: duplicate group-ID receipt check.
- AC-009: tests and public wording.

## Exclusions

- Adding group-local planners or any pre-planner model phase.
- Changing reviewer/verifier finding or verification semantics.
- Removing Ralph's own token budget.
- Reintroducing public numeric budget fields on the review tool.

## Assumptions And Provenance

- User-ratified classification-not-review intent and rejection of review token budgets.
- Live run `92c7e48c` and source inspection recorded in this task's research record.
- Decisions in this bundle keep one slim planner and drop review token gates.

## Related Records

None.

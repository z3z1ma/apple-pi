Status: active
Created: 2026-08-15
Updated: 2026-08-15

# Gated task-local work items

## Purpose And Authority

This specification defines task-local implementation work items and their Ralph closure authority. Work items decompose implementation; `AC-###` criteria continue to define required behavior. Task Markdown remains final state authority and receipts preserve run transitions.

RFC 2119 terms are normative.

## Actors And Boundaries

- An authorized human or main orchestrator may maintain work items outside an active Ralph lease.
- Ralph executors may propose completion but MUST NOT edit ledger records.
- Independent review falsifies implementation and proposal evidence.
- Ralph judges confirm or reject exactly the executor's proposals.
- The Ralph controller is the sole work-item writer while it owns the task lease.

## Required Behavior

### Syntax and parsing

- `task.md` MAY contain one `## Work Items` section between Acceptance Criteria and References.
- Each item MUST occupy one list line:
  - `- [ ] WI-001: description` is open;
  - `- [x] WI-001: description` is complete;
  - `- [-] WI-001: description — Cancelled: substantive reason` is cancelled.
- IDs MUST be unique canonical uppercase `WI-###` values and MUST NOT be reused after cancellation.
- Descriptions and cancellation reasons MUST be substantive.
- The parser MUST report malformed work-item-looking lines, duplicate IDs, invalid states, and misplaced sections rather than silently dropping them.
- A task without Work Items has zero work-item gates and remains compatible.

### Mutation authority

- Outside an active Ralph lease, authorized work-item mutation MUST acquire the same task-bundle lease resource, then perform queued digest compare-and-swap through the canonical task parser.
- Supported operations are add, reorder, complete, reopen, and cancel. Delete and rename are not supported.
- Every failed validation, lease, or digest check MUST leave task bytes unchanged.
- During Ralph, executors propose unique `{id, evidence}` completions targeting currently open known items. Evidence MUST be substantive.
- Independent review receives proposal evidence as falsification context.
- Judge output MUST assess exactly the proposed IDs and separate confirmed from rejected IDs with reasons. It MUST NOT invent IDs.
- The controller MAY complete only judge-confirmed IDs. Executors and judges MUST NOT add, reorder, reopen, cancel, remove, or rename items.

### Closure and receipts

- Ralph MUST recompile after confirmed mutations.
- Any open item or work-item parse issue MUST block closure independently of acceptance-criterion evidence.
- Complete and validly cancelled items do not block closure.
- Rejected proposals remain open and MUST appear in the next objective or terminal reason.
- Ralph schema-v2 receipts MUST add proposal, judgment, confirmed/rejected IDs, and resulting work-item state or digest as optional validated fields.
- Existing schema-v2 receipts without those fields remain loadable; legacy schema-v1 remains audit-only.

## Error And Failure Behavior

- Unknown, duplicate, cancelled, complete, malformed, or out-of-scope proposal IDs fail before mutation.
- Judge omission, duplication, or invention fails output validation and leaves work items unchanged.
- A crash after judgment but before mutation MUST NOT make the proposal appear complete; `task.md` remains final authority.
- A foreign task lease or digest drift fails without stealing authority or partially writing.
- Generic evidence prose MUST NOT satisfy work-item completion without judge confirmation.

## Given-When-Then Scenarios

- Given a task with no Work Items section, when Ralph evaluates closure, then prior closure behavior is preserved.
- Given complete AC evidence and one open WI, when the judge requests closure, then Ralph refuses and names the open ID.
- Given an executor proposes WI-002 complete and review falsifies it, when judgment runs, then WI-002 remains open and the next objective names it.
- Given a judge confirms an ID the executor did not propose, when output is parsed, then the stage fails and task bytes remain unchanged.
- Given a human cancels an item with a substantive reason outside Ralph while no lease is active, when closure is evaluated, then the item does not block and the reason remains in task history.
- Given a foreign Ralph run owns the task lease, when another actor attempts a work-item mutation, then it fails without changing the file.

## Acceptance Mapping

- AC-001: canonical optional parsing and diagnostics.
- AC-002: leased digest-checked mutation and failure atomicity.
- AC-003: executor proposal, review context, and exact judge assessment.
- AC-004: independent work-item closure gates and rejected-proposal behavior.
- AC-005: additive validated receipt compatibility.
- AC-006: skills, documentation, and regression coverage.

## Exclusions

- Active-task selection, task picker UI, operations hub, priorities, tags, due dates, assignment, or nested work-item dependency graphs.
- Treating work-item completion as acceptance evidence.
- Automatic cancellation or removal by an executor or judge.

## Assumptions And Provenance

- User-ratified: work items are stable `WI-###` implementation decomposition and unfinished items gate closure.
- Repository-backed: Ralph already owns task mutation during a run and uses task-bundle leases plus digest compare-and-swap.
- Research-backed: the bootstrap must occur outside the currently loaded Ralph runtime and be followed by reload.

## Related Records

- `.ledger/202608151843-bootstrap-gated-work-items/research/current-state.md`

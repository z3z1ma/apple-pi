Status: active
Created: 2026-08-15
Updated: 2026-08-15

# Branch-scoped active ledger task

## Purpose And Authority

This specification defines a session working-set pointer to one ledger task. The top-level ledger index remains the catalog, each `task.md` remains task and work-item authority, and Ralph receipts remain run authority. Session entries contain pointers only.

RFC 2119 terms are normative.

## Actors And Boundaries

- The human selects, clears, inspects, and edits tasks when authorized.
- The main model may list, select, clear, shape, and maintain task work items through the model-facing ledger surface.
- The operations hub projects task state and MUST NOT become a second authority.
- Gated work-item syntax, mutation, and closure semantics are supplied by the completed bootstrap dependency and MUST NOT be reimplemented here.

## Required Behavior

### Catalog and selection

- The ledger surface MUST read canonical task paths from the top-level ledger index and derive title, status, acceptance criteria, and work-item progress from each referenced `task.md` through the canonical task parser.
- Selecting an active task MUST validate task ID, canonical path, index membership, readable regular-file boundary, and linked-checkout ledger root used by Ralph.
- Selection MUST append a versioned custom session entry containing only canonical `ledgerRoot` and project-relative `taskPath`.
- Clearing MUST append an explicit tombstone entry. Prior entries remain append-only history.
- On `session_start`, reload, fork, resume, and `session_tree`, the extension MUST scan only the active Pi branch and apply last-valid-entry-wins semantics.
- Different session branches MAY select different active tasks.
- Active selection MUST NOT change task status, acquire a Ralph lease, satisfy a work item, or imply execution authorization.

### Model and human surfaces

- A model-facing ledger tool MUST support bounded list, inspect, select, clear, and authorized work-item mutation actions. It MUST return canonical paths and compact structured state.
- Human commands MUST open the Ledger hub view by default and MAY provide direct select/clear operations for scripting parity.
- Task selection and work-item actions MUST use the same parser, path validation, lease, and mutation APIs as Ralph rather than a second Markdown interpretation.

## Error And Failure Behavior

- A missing, moved, unindexed, malformed, or checkout-incompatible selected task MUST render as stale with the exact reason. The extension MUST NOT silently clear it or choose another task.
- Session entry corruption MUST be ignored record-by-record; the latest earlier structurally valid selection or tombstone remains effective.
- Filesystem validation occurs after choosing the latest structurally valid pointer. A stale latest pointer MUST NOT fall back to an older selection.
- Invalid task paths, digest drift, active foreign leases, or invalid work-item actions MUST fail without partial mutation.
- Non-TUI modes MUST retain tool and explicit command behavior without overlays or terminal input capture.

## Given-When-Then Scenarios

- Given two Pi conversation branches, when each selects a different indexed task, then tree navigation restores the selection belonging to the active branch.
- Given an ignored ledger in the main checkout and implementation in a linked worktree, when a task is selected, then the pointer retains the canonical ledger root and Ralph may later target a separate implementation root.
- Given a selected task is deleted, when the session reloads, then the hub shows a stale pointer with reselect/clear actions and does not activate another task.
- Given a malformed custom entry after a valid selection, when state is reconstructed, then the malformed entry is ignored and the valid selection remains.
- Given a foreign Ralph run owns the selected task lease, when a work-item mutation is requested, then the action fails without changing task Markdown.

## Acceptance Mapping

- AC-004 and AC-005: catalog, selection, branch restoration, and stale-pointer behavior.
- AC-006: integration with prerequisite work-item authority without duplicate parsing or mutation.
- AC-007: non-TUI behavior and safe error projection.
- AC-008: parser reuse, session restoration, authority, and lifecycle tests.
- AC-009: ledger and Ralph documentation.

## Exclusions

- Cross-session assignment, claiming, lock stealing, garbage collection, due dates, priorities, and tags.
- Automatic task selection from conversation text or current Git branch.
- A second work-item parser or closure policy.

## Assumptions And Provenance

- User-ratified: active-task selection is session-branch scoped.
- Decision-backed: `.ledger/202608151813-build-harness-operations-ui/decisions/interaction-model.md`.
- Repository-backed: task, receipt, root, and lease authority described in `docs/ledger.md` and `docs/ralph.md`.

## Related Records

- `.ledger/202608151813-build-harness-operations-ui/decisions/interaction-model.md`
- `.ledger/202608151813-build-harness-operations-ui/research/current-state.md`

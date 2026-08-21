Status: cancelled
Created: 2026-08-15
Updated: 2026-08-17
Depends-On: .ledger/202608151843-bootstrap-gated-work-items/task.md

# Build interactive review, Ralph, and ledger-task operations UI

## Scope

Design and implement a coherent terminal operations experience for long-running review and Ralph work. Review must expose live stage and group progress with useful drill-down. Ralph must expose a navigable fleet of ledger-task runs across authorized worktrees. The ledger itself must support selecting one session working-set task and projecting bounded task-local work items without creating a second task database or weakening task authority.

## Non-goals

- Making internal review, executor, or judge agents publicly resumable or steerable.
- Replacing the top-level ledger index, `task.md`, or append-only receipts with an in-memory or user-global task store.
- Letting UI state close tasks, satisfy acceptance criteria, or bypass Ralph gates.
- Reimplementing generic TUI controls already supplied by Pi or the subagent UI.
- Changing budget policy; the separate caller-budget task owns that outcome.
- Reimplementing gated work-item parsing, mutation, role outputs, receipts, or closure semantics supplied by the bootstrap dependency.

## Acceptance Criteria

- AC-001: A long-running review continuously shows its current stage, cycle, partitions, focuses queued/running/completed/failed, coverage, retained findings, elapsed time, and usage without exposing internal agents through the public subagent API.
- AC-002: Review has a keyboard-navigable detail view for active and persisted runs that can inspect cycles, partitions, focuses, findings, verification decisions, meta-review, residual risk, failures, and receipt-backed status, and can stop an owned active run with explicit confirmation.
- AC-003: Ralph has a bounded fleet view for active and recent runs that identifies task, workspace, ledger root, iteration, current executor/review/judge stage, next objective or terminal gate, elapsed time, and usage; the user can navigate to run details and stop an owned active run.
- AC-004: The task picker lists canonical tasks from the top-level ledger index, shows status derived from each `task.md`, supports fuzzy selection, and offers inspect/start/run-oriented actions without duplicating task status.
- AC-005: A user or model can set and clear one active ledger task for the current session branch; reload and tree navigation reconstruct the correct pointer from session state, and the pointer contains only canonical task identity rather than copied task content.
- AC-006: Ledger and hub surfaces consume the dependency's canonical gated work-item parser and mutation APIs; work-item progress, actions, errors, and closure state are projected without a second interpretation.
- AC-007: Live widgets and overlays are bounded by terminal width and height, respond to theme invalidation, do not capture input while unrelated dialogs or editors own focus, and degrade safely outside TUI mode.
- AC-008: Controller progress events are typed, monotonic, testable, and separate from receipt persistence; terminal UI tests cover lifecycle updates, narrow rendering, navigation, cancellation, session restoration, and internal-agent privacy.
- AC-009: Review, Ralph, ledger, README, package-loader, and usage documentation describe the observable workflow and exact controls.

## Work Items

- [-] WI-001: Add typed, monotonic Review and Ralph progress subscriptions plus bounded internal-agent activity callbacks. — Cancelled: The operator explicitly removed the unified operations runtime and its progress surface.
- [-] WI-002: Implement canonical ledger catalog parsing, branch-scoped active-task entries, stale-pointer behavior, and model/human ledger actions. — Cancelled: The operator explicitly replaced catalog and active-task machinery with a scaffold-only tool.
- [-] WI-003: Integrate the dependency's canonical WI-### parser, mutation, receipt, and closure state into ledger actions, progress snapshots, and hub projections without duplicating authority. — Cancelled: Existing ledger records now use ordinary repository reads and edits rather than a parser-backed model tool.
- [-] WI-004: Build shared bounded operations-hub components, navigation, detail overlays, lifecycle disposal, and compact status projection. — Cancelled: The operator explicitly deleted the ledger operations hub and commands.
- [-] WI-005: Integrate live and persisted review cycle, partition, focus, finding, verification, meta-review, usage, and stop behavior into the hub and tool updates. — Cancelled: Review remains an independent skill and no shared operations hub remains.
- [-] WI-006: Integrate multi-root Ralph fleet, nested review progress, iteration detail, usage, objectives, gates, and stop behavior into the hub. — Cancelled: Ralph remains a skill-driven pi_exec loop rather than an operations-hub runtime.
- [-] WI-007: Complete TUI, controller, parser, session-branch, authority, closure, mode, package-loader, and documentation coverage. — Cancelled: The replacement architecture intentionally has no ledger TUI, controller, parser, or active-task session state.

## References

- `.ledger/202608151813-build-harness-operations-ui/decisions/interaction-model.md`
- `.ledger/202608151813-build-harness-operations-ui/plans/implementation.md`
- `.ledger/202608151813-build-harness-operations-ui/specs/active-task.md`
- `.ledger/202608151813-build-harness-operations-ui/specs/operations-hub.md`
- `.ledger/202608151813-build-harness-operations-ui/research/current-state.md`
- `.ledger/202608151813-build-harness-operations-ui/research/current-state-2026-08-16.md`
- `components/review/src/index.ts`
- `components/review/src/controller.ts`
- `components/ralph/src/index.ts`
- `components/ralph/src/controller.ts`
- `components/subagents/src/ui/agent-widget.ts`
- `components/subagents/src/ui/fleet-list.ts`
- `components/subagents/src/ui/conversation-viewer.ts`
- `extensions/runtime-ui.ts`
- `docs/ledger.md`
- `docs/review.md`
- `docs/ralph.md`

## Assumptions

- User-ratified: review and Ralph require rich interactive terminal visibility comparable to the subagent and Pi Exec experiences.
- User-ratified: active-task selection is session-branch scoped, WI-### work items gate closure, and one operations hub owns Ledger, Ralph, and Review navigation.
- Decision-backed: `.ledger/202608151813-build-harness-operations-ui/decisions/interaction-model.md` defines pointer, work-item, mutation, and UI topology choices.
- Record-backed: the top-level ledger index, task records, and receipts remain authoritative; UI and session state are projections and pointers only.
- Record-backed: internal harness agents must remain hidden from public resume, steering, and fleet APIs.

## Journal

- 2026-08-15: Opened after inspecting current review/Ralph widgets, controller lifecycles, receipts, reusable subagent and Pi Exec UI, Pi TUI APIs, and the referenced todo extension.
- 2026-08-15: Kept active-task state pointer-only and deferred work-item syntax and mutation authority to an explicit specification.
- 2026-08-15: Operator selected branch-scoped task restoration, gated WI-### work items, and a unified operations hub; activated the governing decision and behavioral specifications.
- 2026-08-15: Split gated work-item authority into a manual bootstrap dependency so legacy Ralph cannot close this root while ignoring open work items or mix new role skills with old in-memory parsers.
- 2026-08-15: Bootstrap task `202608151843-bootstrap-gated-work-items` closed in `bc57e35`; the operator confirmed Pi reload before this task resumed.
- 2026-08-15: Reloaded Ralph initially compiled this task without projecting WI-001 through WI-007; inspector projection was added in `c6fc6f1`.
- 2026-08-15: After the subsequent operator-confirmed Pi reload, Ralph `inspect` enumerated WI-001 through WI-007 as open; the bootstrap commissioning gate is satisfied.
- 2026-08-16: Replanned against the current cycle/partition/focus review controller, shipped work-item APIs, component-local tests, and in-repo rich TUI patterns. Remapped AC-001, AC-002, and WI-005 from semantic groups to the live review domain.
- 2026-08-17: Operator superseded this outcome: delete the ledger catalog, parser, active-task state, operations UI, and commands; retain only a scaffold tool and inject the complete ledger contract into every agent class.

## Blockers

Cancelled by explicit operator decision; this task no longer governs implementation.

## Evidence

- 2026-08-15: Bootstrap dependency closed in `bc57e35`; operator confirmed the required Pi reload before resuming this WI-bearing task.
- 2026-08-15: Reloaded Ralph initially compiled the task graph but did not enumerate work items.
- 2026-08-15: After reload of `c6fc6f1`, Ralph `inspect` compiled graph `a0dcd1d20435b10dda20d93bcfbe707284b8eb8423d0eddb5b8a62712d198807` and reported `7 total; 7 open; WI-001` through `WI-007`.
- 2026-08-17: Replacement change deletes `components/ledger/`, `components/operations/`, `extensions/harness.ts`, `/ledger`, and `/harness`; package loading, type checking, lint, unit, VCC, Advisor, loader, and package dry-run checks passed.

## Review

Cancelled by operator decision before acceptance review; the replacement scaffold-and-prompt architecture was independently reviewed instead.

## Retrospective

A UI/session projection did not teach models the ledger contract and created a large second runtime surface. Model understanding belongs in one shared system-prompt contract, while task creation needs only a narrow scaffold boundary.

## Distillation

The replacement contract lives in `components/shared/src/ledger-system-prompt.ts`, creation lives in `extensions/ledger.ts`, and maintainer-facing semantics remain in `docs/ledger.md`. This cancelled bundle remains historical and must not be treated as active authority.

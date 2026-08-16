Status: active
Created: 2026-08-15
Updated: 2026-08-15

# Unified ledger, Ralph, and review operations hub

## Purpose And Authority

The operations hub makes long-running harness work observable and controllable without exposing internal role agents or replacing task and receipt authority. It is a TUI projection over ledger records, controller progress, and validated receipts.

RFC 2119 terms are normative.

## Actors And Boundaries

- The human navigates the hub, inspects details, selects an active task, starts contextual actions, and confirms stop requests.
- The main model continues to orchestrate through model-facing ledger, Ralph, and review tools.
- ReviewController and RalphController publish typed progress snapshots and retain lifecycle authority.
- Managed internal agents remain inaccessible through public subagent list, resume, steer, and stop tools.
- Pi's TUI owns focus, theme, width, lifecycle, and non-interactive mode behavior.

## Required Behavior

### Topology and entrypoints

- `/harness` MUST open one overlay with Ledger, Ralph, and Review views and preserve selection while switching views.
- `/ledger` MUST open the Ledger view. `/ralph` and `/review` without operational arguments SHOULD open their corresponding hub views; existing explicit actions remain command parity.
- Model-facing tools MUST keep compact call/result rows and stream structured partial progress through `onUpdate` while widgets and the hub provide live detail.
- One shared compact widget/status projection MUST summarize the active task and live Ralph/review operations without competing static widget IDs.

### Controller progress contract

- ReviewController and RalphController MUST expose read-only subscriptions or an equivalent typed event stream; UI code MUST NOT inspect private active maps.
- Every progress snapshot MUST include run ID, immutable roots/source identity, monotonic sequence, state/stage, start/update times, resolved internal policy summary, usage, and terminal outcome when present.
- Review progress MUST include planner status; every semantic group's tier, item coverage, queued/running/completed/failed state, current bounded activity, finding count; and verifier state and decisions.
- Ralph progress MUST include task path, workspace and ledger roots, iteration, executor/review/judge stage, current bounded activity, work-item progress, next objective, and gate reason.
- ManagedSubagentService MUST supply only the bounded activity callbacks needed by owning controllers. This MUST NOT make internal records publicly discoverable or resumable.
- A new subscriber MUST receive a current snapshot immediately, and unsubscription MUST stop updates and timers.
- Receipt append and task mutation remain authoritative side effects; progress delivery failure MUST NOT fail or alter a run.

### Hub views

- Ledger view MUST provide fuzzy task filtering, status and work-item progress, active-task marker, stale-pointer state, and contextual inspect/select/clear/start/run actions.
- Every successful Review or Ralph action that resolves a project root MUST append a versioned branch-local operations-pointer entry containing only operation kind, canonical project root, and optional run ID. Repeated pointers MAY be deduplicated during projection but remain append-only in session history.
- The hub MUST derive “roots known to the session” only from valid pointers on the active Pi branch and the current trusted session root. It MUST NOT scan global receipt directories to discover projects or worktrees.
- Every restored root MUST be canonicalized and revalidated as a linked checkout sharing the trusted session repository's Git common directory before any receipt is read. Missing or no-longer-related roots remain visible as stale pointers with clear/remove actions and MUST NOT be traversed.
- Ralph view MUST load active and recent receipt-backed runs separately from each validated known workspace root, with task, stage/state, iteration, elapsed time, usage, next objective or gate, and ownership.
- Review view MUST load active and recent runs separately from each validated known project root with source/profile, stage, group coverage, findings, elapsed time, usage, and ownership.
- Detail views MUST be scrollable and render source/task identity, stage timeline, groups or iterations, failures, retained findings and verification, residual risk, child activity summaries, usage, and receipt path as applicable.
- Active owned runs MUST offer a two-step or explicit-confirmation stop action. Non-owning live runs MUST explain where they are owned rather than claiming to stop them.
- Internal model text or tool activity shown in the hub MUST be bounded and local-only. It MUST NOT be appended to the parent model context.

### Rendering and input

- Every rendered line MUST fit the supplied terminal width, and overlays MUST cap height with visible scroll state.
- The hub MUST use injected theme and keybindings, rebuild themed content on invalidation, and request rendering only after state changes or bounded animation ticks.
- Global terminal handlers MUST remain inactive while the editor contains text or another dialog/component owns focus.
- Escape closes or backs out; arrows navigate; Enter opens or confirms; destructive stop requires explicit confirmation. Exact hints MUST use configured keybindings where Pi exposes them.
- Completion rows and widgets MUST disappear or settle predictably after terminal outcomes without losing receipt-backed history from the hub.

### Lifecycle and modes

- On session start, reload, tree navigation, fork/resume, and shutdown, subscriptions, active-task projection, timers, overlays, and controllers MUST be established or disposed idempotently.
- In RPC, JSON, and print modes, controller execution and tool progress MUST continue without TUI-only APIs. `ctx.mode === "tui"` gates overlays and terminal input.
- A TUI exception MUST fall back to compact tool/notification output and MUST NOT stop the underlying review or Ralph run.

## Error And Failure Behavior

- Corrupt receipt chains MUST remain visible as explicit load errors and MUST NOT be omitted from a list as if no run existed.
- Workspace conflicts, authority denials, budget/safety stops, provider failures, compaction, operator stops, and stale task pointers MUST use distinct labels and colors without manufacturing success.
- Controller progress sequence regressions or run-identity mismatches MUST be rejected by the projection and surfaced as UI errors; they MUST NOT alter receipts.
- If a selected run completes while its detail view is open, the view MUST settle to final state and remain readable until the user closes it.
- If a session switches or shuts down, active controller work MUST use the existing stop-and-quiesce contract before UI resources are disposed.

## Given-When-Then Scenarios

- Given a review planner creates six groups, when two reviewers run concurrently, then the widget and Review view show two running, four queued, and update each group without exposing public agent IDs.
- Given a reviewer files findings, when verification starts, then the Review detail view preserves group coverage and shows each finding's pending then final verification state.
- Given Ralph enters shared review, when the user opens the Ralph run, then the detail view shows the nested review stage and its progress under the Ralph iteration rather than as an unrelated public run.
- Given two Ralph tasks run in different authorized worktrees through actions on the active session branch, when the hub opens, then their validated root pointers load both receipt sets with distinct roots and stages and neither can claim the other's workspace lease.
- Given a receipt exists for an unrelated repository in the global agent directory, when the hub opens, then it is not discovered or read because no validated branch-local root pointer authorizes it.
- Given an active run is selected and the user requests stop, when confirmation succeeds, then the owning controller aborts, waits for quiescence, records terminal state, and the view settles to stopped.
- Given the terminal is narrow, when the hub renders, then rows truncate or wrap within width and navigation remains usable without line overflow.
- Given Pi runs in print mode, when the model invokes review or Ralph, then no overlay/widget is mounted and the tool still returns structured progress/final output.

## Acceptance Mapping

- AC-001 and AC-002: review progress, detail, history, and stop behavior.
- AC-003: Ralph fleet, detail, multi-root identity, and stop behavior.
- AC-004 and AC-005: Ledger view and active-task projection.
- AC-007: rendering, focus, lifecycle, and non-TUI behavior.
- AC-008: typed progress contract and TUI/controller tests.
- AC-009: commands, model-tool rendering, and documentation.

## Exclusions

- Public steering or resumption of harness-owned internal agents.
- OS-level sandboxing or remote run control.
- Editing source files or ledger Markdown inside the detail overlay beyond explicit ledger actions.
- Replacing textual tool results in JSON/print modes with terminal escape output.

## Assumptions And Provenance

- User-ratified: use one unified operations hub.
- Decision-backed: `.ledger/202608151813-build-harness-operations-ui/decisions/interaction-model.md`.
- Research-backed: existing subagent and Pi Exec UI components establish reusable rendering and lifecycle patterns.
- Pi-documentation-backed: overlays, widgets, status, partial tool rendering, focus, and mode gates are current in Pi 0.84.2.

## Related Records

- `.ledger/202608151813-build-harness-operations-ui/decisions/interaction-model.md`
- `.ledger/202608151813-build-harness-operations-ui/research/current-state.md`

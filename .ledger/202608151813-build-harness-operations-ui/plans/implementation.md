Status: active
Created: 2026-08-15
Updated: 2026-08-15

# Implementation plan

## Outcome

Implement one branch-aware operations surface for Ledger, Ralph, and Review while preserving existing authority:

- `/harness` owns the unified TUI; `/ledger`, argument-less `/review`, and argument-less `/ralph` enter their contextual views in TUI mode.
- Existing explicit Review/Ralph actions, controllers, leases, stop-and-quiesce behavior, receipts, root boundaries, and tools remain authoritative.
- The top-level ledger index remains the task catalog; each `task.md` remains task/work-item authority; validated receipts remain run authority.
- Pi custom entries contain only branch-local task or root/run pointers and append-only tombstones.
- Internal planner/reviewer/verifier/executor/judge agents remain inaccessible through public subagent list, result, resume, steer, stop, widget, and fleet APIs.
- Current budget-policy fields, arithmetic, defaults, and exhaustion behavior are not redesigned.
- The gated-work-item bootstrap dependency is done, independently reviewed, fully validated, and loaded through Pi `/reload` before this plan begins; this task consumes that authority without reimplementing it.

## Current-System Evidence

- `components/review/src/controller.ts` owns Review lifecycle, leases, managed agents, receipts, findings, coverage, and stop quiescence. Its active-run map is private and it exposes no typed progress subscription.
- `components/ralph/src/controller.ts` owns Ralph execution, workspace/task leases, executor/shared-review/judge sequencing, task mutation, closure gates, and stop quiescence. Its nested `ReviewController` is private.
- `components/review/src/index.ts` and `components/ralph/src/index.ts` mount separate static widgets and do not use tool `onUpdate` for live structured progress.
- `components/review/src/receipts.ts` currently has `listReviewRunSummaries`, which catches corrupt run loads and silently omits them.
- `components/ralph/src/receipts.ts` currently has `listRunSummaries`, which propagates errors for corrupt current-schema runs while skipping matched legacy schema-v1 audit-only runs.
- `components/ralph/src/work-graph.ts` owns task Markdown parsing and compilation. `components/ralph/src/task.ts` owns digest-checked queued task mutation.
- `components/ralph/src/lease.ts` already uses the canonical task bundle as a lease resource, providing the correct concurrency boundary for work-item mutation.
- `components/subagents/src/service.ts` exposes managed execution/abort and bounded usage/compaction callbacks. `components/subagents/src/index.ts` uses `internalOwner`, and public controls filter internal records.
- `components/subagents/src/ui/agent-widget.ts`, `components/subagents/src/ui/fleet-list.ts`, and `components/subagents/src/ui/conversation-viewer.ts` provide useful width, focus, disposal, and stop-confirmation patterns, but their public-agent/session projections are not safe abstractions for harness roles.
- Pi persistence supports `pi.appendEntry(...)` and `ctx.sessionManager.getBranch()`. Plain custom entries remain outside model context, making active-branch folding the correct pointer mechanism.
- Pi's `SelectList.setFilter()` performs prefix filtering, not the fuzzy matching required by the Ledger picker. Pi instead exports `fuzzyFilter` and `fuzzyMatch`.

## Change Surfaces

### Bootstrap dependency boundary

- Before any implementation, verify the gated-work-item prerequisite is `done`, its targeted and full validation plus independent review are recorded, and Pi has been reloaded since that completion.
- Confirm the reloaded Ralph inspector recognizes this task's Work Items section and reports its open WI state. Only then clear the root task's bootstrap blocker.
- Consume the dependency's canonical task parser, typed work-item state, leased digest-checked mutation API, executor/judge outputs, receipt fields, and closure gates.
- Do not add a second Markdown parser, work-item transition model, or closure policy in the operations component.
- Ledger actions and UI projections may call and render those APIs, but task and Ralph controller authority remain in the dependency-owned Ralph modules.

### Receipt compatibility and safe run enumeration

- Add safe per-run enumeration APIs to `components/review/src/receipts.ts` and `components/ralph/src/receipts.ts`.
- These APIs enumerate only the expected receipt namespace beneath an already validated known root and return discriminated rows such as `summary`, `load_error`, and `legacy_audit` where relevant.
- Preserve current contextual behavior:
  - `listReviewRunSummaries` may continue filtering load-error rows to match its existing silent-omission contract.
  - Ralph `listRunSummaries` may continue skipping schema-v1 audit records and propagating a current-schema load error.
  - The hub consumes safe discriminated enumeration and renders per-run errors without failing healthy rows.
- Do not scan a global receipt root or unrelated worktrees. Enumeration begins only after active-branch pointer folding and linked-root revalidation.

### Typed progress without authority transfer

- Add `components/operations/src/progress-channel.ts` with per-run monotonic sequence numbers, immutable cloned snapshots, immediate active-snapshot replay, idempotent unsubscribe, and subscriber-error isolation.
- Extend `components/review/src/types.ts` with `ReviewProgressSnapshot` containing immutable run/root/source/profile identity, sequence and timestamps, state/stage, resolved policy summary and usage, planner status, semantic group state/tier/coverage/activity/finding count, verifier decisions, findings, failures, residual risk, and terminal outcome.
- Extend `components/ralph/src/types.ts` with `RalphProgressSnapshot` containing immutable run/workspace/ledger/task identity, sequence and timestamps, stage/state/iteration, usage and resolved policy summary, bounded executor/judge activity, work-item progress, nested Review projection, objective, gate, and terminal outcome.
- Add `subscribeProgress()` and ownership classification to both controllers. UI code must never access private active maps.
- Extend `components/subagents/src/service.ts` with a sanitized `ManagedAgentActivity` callback containing only phase, role-local tool names, turn/tool counts, and a bounded semantic label.
- Wire it through `components/subagents/src/index.ts` without changing public subagent visibility. Do not expose agent IDs, session paths, prompts, tool arguments, transcripts, or raw model text.
- Ralph passes a scoped Review progress observer into its nested controller and republishes only the nested domain snapshot. Nested Review stop authority remains with Ralph.

### Branch-local task and operation pointers

- Add `components/operations/src/session-state.ts` with strict custom-entry unions:
  - active selection: `{schemaVersion: 1, ledgerRoot, taskPath}`;
  - active-task tombstone: `{schemaVersion: 1, cleared: true}`;
  - operation pointer: `{schemaVersion: 1, kind: "review" | "ralph", projectRoot, runId?}`;
  - operation-root tombstone containing only version, operation kind, root identity, and removal marker.
- Fold only `ctx.sessionManager.getBranch()` in branch order:
  1. Ignore malformed records individually.
  2. Apply last-valid-entry-wins, including tombstones.
  3. Structurally valid selection pointers remain selected even if filesystem revalidation later makes them stale; never fall back to an older pointer.
  4. Fold operation pointers/tombstones by kind/root and deduplicate repeated records in the projection while preserving append-only history.
- Revalidate active task pointers against canonical ledger root, trusted session repository Git common directory, linked-checkout relationship, top-level index membership, regular non-symlink task-file boundary, and the shared task parser.
- Missing, moved, unindexed, malformed, or unrelated selections remain visible with an exact stale reason and explicit clear/reselect actions.
- Known Review/Ralph roots consist only of the current trusted session worktree and valid operation pointers on the active branch.
- Missing or no-longer-related operation roots remain visible as stale pointer rows, but the hub must not traverse their receipt paths.
- Record operation pointers only after a successful root resolution or durable run start. Background commands should await the controller's started handshake before detaching so the pointer is appended to the branch that initiated the action.
- Reconstruct on every `session_start` reason and on `session_tree`.

### Ledger catalog and model actions

- Add `components/ralph/src/catalog.ts`:
  - Parse canonical task paths from the top-level ledger index.
  - Derive title, status, digest, acceptance criteria, and WI progress from each `task.md`, never from index prose.
  - Validate canonical indexed paths and existing file/root boundaries.
  - Provide bounded pagination for model results.
- Add `components/operations/src/ledger-tool.ts` with bounded `list`, `inspect`, `select`, `clear`, and `mutate_work_items` actions.
- Selection appends only the canonical root/path pointer. Clearing appends a tombstone.
- Work-item mutations return before/after digests and typed progress; they call the same leased mutation path used outside the UI.

### Services and unified operations runtime

- Add `components/review/src/operations-service.ts` and `components/ralph/src/operations-service.ts` using the existing event-bus discovery pattern. Each exposes active progress subscriptions, authorized receipt queries, ownership classification, controller-owned stop, and `stopAll`.
- Ownership must distinguish active and owned by this controller, active in another process/session, nested under Ralph, and non-live/stale receipt.
- Add `components/operations/src/index.ts` and `extensions/harness.ts`:
  - Register `/harness`, `/ledger`, and the `ledger` model tool.
  - Install the hub service used by contextual `/review` and `/ralph` entrypoints.
  - Merge active progress and recent receipt rows only after known-root validation.
  - Recheck ownership after destructive confirmation, call only the owning controller, and await quiescence.
- Add the extension after Review and Ralph in `package.json`, include its sources in package files, and update `tsconfig.json`.

### Shared versus domain-specific UI

Add `components/operations/src/ui/` with explicit boundaries:

- Shared primitives:
  - `hub.ts`: tabs, preserved per-view selection, focus routing, lifecycle.
  - `bounded-lines.ts`: ANSI-safe width and height clamping.
  - `detail-view.ts`: Pi `ScrollView` detail shell and confirmation state.
  - `compact-widget.ts`: the single active-task/Review/Ralph widget/status projection.
  - `tool-renderers.ts`: partial/final compact and expanded cards.
- Ledger projection in `ledger-view.ts`:
  - Use Pi `Input` for the focused query.
  - Apply Pi `fuzzyFilter` or `fuzzyMatch` over task ID, title, and canonical path.
  - Rebuild the generic `SelectList` from fuzzy-ranked results while preserving the selected task ID.
  - Do not use `SelectList.setFilter()` as the fuzzy implementation.
  - Show active/stale state, task status, WI counts, and inspect/select/clear/start/run actions.
- Review projection in `review-view.ts`: show planner, group state/activity, coverage, findings and verification decisions, failures, residual risk, usage, receipt path, and ownership-aware stop.
- Ralph projection in `ralph-view.ts`: show bounded multi-root active/recent runs, workspace/ledger/task identity, stage/iteration, objective/gate, WI progress, nested Review, usage, receipt path, and ownership-aware stop.

Reuse Pi's `SelectList`, `Input`, `ScrollView`, theme helpers, and injected keybindings. Do not reuse `ConversationViewer`, which is coupled to public resumable sessions and steering.

Exact interaction behavior:

- Left/right or Tab changes views while preserving each view's selection.
- Configured selection keys and page keys navigate lists/details.
- Enter opens a selected row or confirms an action.
- `/` focuses the Ledger fuzzy query.
- Escape clears focused search, returns from detail/action state, then closes the hub.
- Stop/remove/clear requires an explicit confirmation state; no single accidental key performs destructive action.
- The compact widget is render-only and registers no global terminal-input handler.

### Entrypoints, modes, and documentation

- Update `components/review/src/index.ts` and `components/ralph/src/index.ts` to preserve explicit actions, route argument-less TUI commands to contextual hub views, replace separate static widgets with the shared operations widget, stream throttled structured `onUpdate` snapshots, and append validated operation pointers after successful actions.
- Non-TUI modes must never call overlay, widget, or terminal-input APIs. Explicit commands/tools still execute and return bounded text/structured results.
- On session switch/shutdown, first call Review/Ralph owner services' existing `stopAll` and await quiescence, then dispose overlay, subscriptions, refresh jobs, timers, widget, and status keys idempotently.
- Update `README.md`, `docs/ledger.md`, `docs/review.md`, and `docs/ralph.md` with exact controls, branch-pointer semantics, stale roots, WI authority, receipt/error behavior, and non-TUI behavior.

## Sequence

1. **Commission the bootstrap boundary.** Verify the prerequisite task is done with recorded full validation and independent review, reload Pi, use the reloaded Ralph inspector to observe this task's open Work Items, and only then clear the root task's bootstrap blocker.
2. **Characterize existing authority.** Add tests for explicit commands/tools, foreign lease refusal, stop quiescence, receipt loading behavior, internal-agent filtering, and dependency-owned work-item integration. Confirm current tests pass before modifying interfaces.
3. **Build catalog and branch-state logic without UI.** Implement canonical catalog, active-task pointer folding, operation pointers, tombstones, stale validation, and no-global-scan known roots. Register and test model Ledger actions against the dependency APIs.
4. **Add typed controller progress.** Publish Review and Ralph snapshots at durable transitions and sanitized activity updates; add nested Review projection and immediate replay.
5. **Add safe per-run receipt rows and operation services.** Preserve old list-function behavior while exposing load-error rows to the hub. Verify only validated root-local receipt namespaces are enumerated.
6. **Add shared UI primitives and compact widget.** Test width, height, focus, keybindings, theme invalidation, terminal linger, and disposal before domain views.
7. **Add Ledger fuzzy picker and actions.** Use `fuzzyFilter`/`fuzzyMatch`; make every action call existing catalog, dependency mutation, or controller authority.
8. **Add Review projection and partial tool rendering.** Merge live snapshots with validated persisted rows, preserve selected details across completion, and restrict stop to locally owned standalone Review runs.
9. **Add Ralph fleet and nested Review projection.** Support multiple validated branch-local roots and preserve Ralph-owned stopping.
10. **Finish lifecycle, packaging, modes, and docs.** Validate isolated extension loading and event-bus services, then run the complete acceptance suite and package checks.

## Acceptance And Backpressure

- **AC-001:** `tests/review-progress.test.ts` must fail unless progress shows planner state, queued/running/completed/failed groups, tier, coverage, bounded activity, findings, elapsed timestamps, policy, and usage with strictly increasing sequences and no internal IDs.
- **AC-002:** `tests/operations-review-view.test.ts` must navigate live and persisted group/finding/verification/failure/receipt details, preserve an open detail after completion, reject foreign/nested stop, and prove owned stop waits for terminal receipt and child quiescence.
- **AC-003:** `tests/operations-ralph-view.test.ts` must load two branch-authorized linked roots, retain separate workspace/ledger/task identities, display stage/iteration/objective-or-gate/WI/usage state, nest Review correctly, and stop only through the owning Ralph controller.
- **AC-004:** `tests/ledger-catalog.test.ts` must prove status/title come from `task.md`, reject unindexed or unsafe paths, fuzzily match non-prefix title/path fragments, and expose inspect/select/start/run actions without duplicating task state.
- **AC-005:** `tests/ledger-session-state.test.ts` must cover divergent branches, tombstones, malformed custom entries, reload/fork/resume/tree restoration, stale deleted/moved/unindexed/malformed/unrelated targets, exact pointer keys, and no custom-entry model context. A stale latest valid pointer must not fall back.
- **AC-006:** `tests/ledger-catalog.test.ts`, `tests/ledger-session-state.test.ts`, `tests/operations-ralph-view.test.ts`, and focused ledger-tool tests must prove every WI display and mutation uses the dependency's canonical parser/API, preserves its errors and lease authority, and reflects receipt/closure state without a second interpretation. The prerequisite's own evidence remains the oracle for parser, role, receipt, and closure semantics.
- **AC-007:** `tests/operations-hub.test.ts` must sweep narrow widths/heights, theme invalidation, configured keys, search/detail focus, confirmation, terminal transition, and disposal. Non-TUI tests must throw if overlay/widget/input APIs are attempted while commands/tools still complete.
- **AC-008:** `tests/review-progress.test.ts`, `tests/ralph-progress.test.ts`, and `tests/operations-tool-rendering.test.ts` must verify immediate replay, monotonic sequence, immutable identity, unsubscribe, mismatch/regression reporting, listener-error isolation, throttled partial updates, cancellation, restoration, and lifecycle cleanup. Extend `tests/subagent-runner-e2e.test.ts` so live internal harness records remain unreachable through all public controls.
- **AC-009:** `tests/package-load.mjs` must require the harness extension, `/harness`, `/ledger`, the `ledger` tool, and all operation-service channels. Documentation checks must require the exact controls and pointer/WI/receipt semantics.

Backpressure per increment:

```text
npm run typecheck
npx vitest run <targeted-files>
```

Final gate:

```text
npm run typecheck
npm test
npm run pack:check
```

UI snapshots are not authority evidence. WI tests must inspect resulting `task.md`, leases, and validated receipt events.

## Risks And Failure Modes

- **Branch leakage:** any use of global session entries or process-global selected-task state can merge sibling branches. Fold only `getBranch()`.
- **Global receipt discovery:** never scan the global agent directory. Begin only with current trusted root plus validated active-branch operation pointers.
- **Silent receipt loss:** Review currently omits corrupt runs and Ralph can abort listing. Hub-specific safe enumerators must preserve per-run load-error rows without changing contextual compatibility.
- **False fuzzy compliance:** `SelectList.setFilter()` is prefix-only. Ledger tests must require a non-prefix fuzzy match.
- **Stale fallback:** choose the latest structurally valid pointer before filesystem validation; stale validation must not resurrect an older pointer.
- **Bootstrap mismatch:** a completed prerequisite without a subsequent Pi reload can leave legacy Ralph in memory. The root blocker stays nonempty until the reloaded inspector demonstrates WI awareness.
- **Authority duplication:** catalog, ledger actions, and UI must consume dependency APIs; re-parsing or reimplementing WI transitions would reintroduce semantic drift.
- **Nested stop bypass:** a Ralph-owned Review cannot expose standalone Review stop. Stop the parent Ralph run.
- **Progress races:** parallel groups may finish in any order. Assign sequence synchronously per run and reject immutable-identity changes in projection state.
- **Internal-agent leakage:** progress and renderers must not include child IDs, prompts, session paths, transcripts, raw arguments, or raw model text.
- **TUI affecting work:** rendering/subscriber errors must be caught and reported without aborting a controller or altering receipts.
- **Lifecycle leaks:** stop/quiesce before disposing every listener, refresh job, timer, widget, status key, and overlay.
- **Scope creep:** do not redesign budget arithmetic/defaults, broadly reorganize controllers/entrypoints, or perform unrelated formatting/convergence work.

## Integration Points

- Pi branch persistence: `pi.appendEntry(...)` and `ctx.sessionManager.getBranch()`.
- Pi TUI: `ctx.mode === "tui"` gates overlays/widgets; use `Input`, `SelectList`, `ScrollView`, `fuzzyFilter`/`fuzzyMatch`, injected keybindings, and theme callbacks.
- Tool streaming: Review and Ralph use throttled structured `onUpdate`; renderers distinguish partial from final output.
- Event bus: Review, Ralph, and harness services follow the isolated-module discovery pattern already used by managed subagents.
- Root security: reuse `components/ralph/src/roots.ts`, `components/ralph/src/path-boundary.ts`, and `components/ralph/src/task-paths.ts`.
- Stop authority remains in Review/Ralph controllers and their existing lease/receipt paths.
- Progress is ephemeral; only controller receipt append functions and explicit WI outcome fields persist.
- UI/catalog state is always derived from indexed `task.md` content and expected digest.

## Rollback Or Recovery

- The gated-work-item dependency is a commissioning prerequisite, not a rollback unit of this task. Do not start or resume this task under Ralph until that dependency is done and the extension has been reloaded and verified WI-aware.
- Controller subscriptions, services, renderers, and the hub are additive and can be disabled independently. Explicit Review/Ralph commands/tools and receipts remain available.
- Pointer entries are append-only and outside model context. Recovery appends tombstones; it never rewrites session JSONL.
- Additive receipt fields require no bulk migration. Existing Review schema-v1 and Ralph schema-v2 runs load without WI fields; Ralph schema-v1 remains audit-only.
- If UI initialization fails, remove the hub/widget projection while preserving semantic gates, explicit operations, and receipts.
- Recover stale tasks/roots only by explicit clear/remove/reselect after validation. Never repair paths, select replacements, or claim leases automatically.
- Recover projection sequence/identity errors by reopening and replaying current controller snapshots plus authorized receipts; never mutate task/run state from the projection.

## Related Records

The gated-work-item prerequisite is represented only by the root task's `Depends-On` edge; task-local supporting records intentionally do not link into another bundle's private graph.

- `.ledger/202608151813-build-harness-operations-ui/decisions/interaction-model.md`
- `.ledger/202608151813-build-harness-operations-ui/specs/active-task.md`
- `.ledger/202608151813-build-harness-operations-ui/specs/operations-hub.md`
- `.ledger/202608151813-build-harness-operations-ui/research/current-state.md`

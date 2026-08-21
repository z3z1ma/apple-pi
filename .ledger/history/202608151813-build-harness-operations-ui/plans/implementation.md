Status: active
Created: 2026-08-15
Updated: 2026-08-16

# Implementation plan

## Outcome

Build one branch-aware operations surface whose live TUI is as rich as the existing subagent, Pi Exec, and questionnaire experiences, while preserving current authority:

- `/harness` owns the unified overlay; `/ledger`, argument-less `/review`, and argument-less `/ralph` enter their contextual views in TUI mode.
- Existing explicit Review/Ralph actions, controllers, leases, stop-and-quiesce, receipts, root boundaries, and tools remain authoritative.
- The top-level ledger index remains the task catalog; each `task.md` remains task/work-item authority; validated receipts remain run authority.
- Pi custom entries contain only branch-local task or root/run pointers and append-only tombstones.
- Internal planner/reviewer/verifier/executor/judge agents remain inaccessible through public subagent list, result, resume, steer, stop, widget, and fleet APIs.
- Current budget-policy fields, arithmetic, defaults, and exhaustion behavior are not redesigned.
- Work-item syntax, leased mutation, receipts, and closure already exist in Ralph. This task consumes `parseTaskDocument` and `mutateTaskWorkItems`; it does not reimplement them.

## Current-System Evidence

Inspected 2026-08-16 against source. Details: `.ledger/202608151813-build-harness-operations-ui/research/current-state-2026-08-16.md`.

- Review is cycle/partition/focus, not semantic groups. `ReviewRun` carries `workGraph.cycles`, `completedItemIds`, `findings`, `metaReviews`, `residualRisk`, `policy`, and `agents`. Receipt stages are `input | planner | reviewer | verifier | finalize`.
- Ralph states are `ready | executing | reviewing | judging | iterating` plus terminals. Independent review is `this.reviewController.run(...)` during `reviewing`. `RalphRun` already has `nextObjective`, `totalTokens`, `activeAgentId`, and work-item receipt envelopes.
- `components/review/src/index.ts` and `components/ralph/src/index.ts` still paint two-line string widgets at start/end. `_onUpdate` is unused. Argument-less `/review` currently runs; argument-less `/ralph` currently statuses.
- Controllers keep private `active` maps and expose no `subscribeProgress`.
- Work-item authority is already shipped: `parseTaskDocument`, `WorkItemMutation`, `mutateTaskWorkItems`, `completeTaskWorkItemsUnderLease`, and schema-v2 work-item receipt fields.
- `listReviewRunSummaries` still omits corrupt runs. Ralph `listRunSummaries` still skips schema-v1 audit-only rows and throws on current-schema load errors.
- `ManagedAgentRequest` has `onStarted`, `onAssistantUsage`, and `onCompaction` only. Public widgets already filter `internalOwner`.
- Richness already exists in-repo and is the copy-from bar: `AgentWidget`, `FleetList`, `ConversationViewer` lifecycle, `ExecActivityWidget`, `QuestionnaireDialog`. Do not reuse conversation steering or public session identity.
- Layout is now `components/<name>/{src,tests}`. `tsconfig.json`, `vitest.config.ts`, `package.json` files, and `tests/package-load.mjs` must gain an operations component and harness extension. Pi remains 0.84.2.

## Change Surfaces

### Consume work-item authority; do not rebuild it

- Call `parseTaskDocument` for catalog title/status/AC/WI projection.
- Call `mutateTaskWorkItems` for human/model work-item edits outside an active Ralph lease.
- Project receipt `workItems` and task-document state; do not add a second parser or transition model.
- Ralph controller authority for in-run completion remains `completeTaskWorkItemsUnderLease`.

### Receipt compatibility and safe run enumeration

- Add hub-facing safe enumerators beside `components/review/src/receipts.ts` and `components/ralph/src/receipts.ts`.
- Return discriminated rows such as `summary`, `load_error`, and `legacy_audit` where relevant.
- Keep current contextual functions unchanged:
  - `listReviewRunSummaries` may continue omitting load-error rows.
  - Ralph `listRunSummaries` may continue skipping schema-v1 and throwing on current-schema load errors.
- Enumerate only the expected receipt namespace under an already validated known root. Never scan the global agent directory.

### Typed progress without authority transfer

- Add `components/operations/src/progress-channel.ts` with per-run monotonic sequences, immutable cloned snapshots, immediate replay, idempotent unsubscribe, and subscriber-error isolation.
- Extend `components/review/src/types.ts` with `ReviewProgressSnapshot`: immutable run/root/source/profile identity, sequence and timestamps, state/stage, cycle index and cap, resolved policy summary and usage, planner status, every partition's coverage, every focus's queued/running/completed/failed state plus bounded activity and finding count, verifier decisions, findings, notes, meta-review, failures, residual risk, and terminal outcome.
- Extend `components/ralph/src/types.ts` with `RalphProgressSnapshot`: immutable run/workspace/ledger/task identity, sequence and timestamps, stage/state/iteration, usage and resolved policy summary, bounded executor/judge activity, work-item progress, nested Review snapshot, objective, gate, and terminal outcome.
- Add `subscribeProgress()` and ownership classification on both controllers. UI code must never read private `active` maps.
- Extend `components/subagents/src/service.ts` with a sanitized activity callback: phase, role-local tool names, turn/tool counts, and a bounded semantic label. Wire it through `components/subagents/src/index.ts` without changing public visibility. Do not publish agent IDs, session paths, prompts, tool arguments, transcripts, or raw model text. Strip `ReviewAgentReceipt.agentId` / `sessionFile` and `RalphRun.activeAgentId` from snapshots and renderers.
- Ralph observes its nested Review subscription and republishes only the nested domain snapshot. Nested Review stop stays on Ralph.

### Branch-local task and operation pointers

- Add `components/operations/src/session-state.ts` with strict custom-entry unions:
  - active selection: `{schemaVersion: 1, ledgerRoot, taskPath}`;
  - active-task tombstone: `{schemaVersion: 1, cleared: true}`;
  - operation pointer: `{schemaVersion: 1, kind: "review" | "ralph", projectRoot, runId?}`;
  - operation-root tombstone with version, kind, root identity, and removal marker.
- Fold only `ctx.sessionManager.getBranch()` in branch order:
  1. Ignore malformed records individually.
  2. Apply last-valid-entry-wins, including tombstones.
  3. A structurally valid latest pointer stays selected even if later filesystem checks mark it stale; never fall back to an older pointer.
  4. Fold operation pointers/tombstones by kind/root and deduplicate in the projection while preserving append-only history.
- Revalidate active-task pointers against canonical ledger root, trusted session Git common directory, linked-checkout relationship, top-level index membership, regular non-symlink task-file boundary, and `parseTaskDocument`.
- Missing, moved, unindexed, malformed, or unrelated selections stay visible with an exact stale reason and explicit clear/reselect actions.
- Known Review/Ralph roots are only the current trusted session worktree plus valid operation pointers on the active branch.
- Record operation pointers only after successful root resolution or durable run start. Background commands should await the controller started handshake before detaching so the pointer lands on the initiating branch.
- Reconstruct on every `session_start` reason and on `session_tree`.

### Ledger catalog and model actions

- Add `components/ralph/src/catalog.ts`:
  - Parse canonical task paths from `.ledger/README.md`.
  - Derive title, status, digest, acceptance criteria, and WI progress from each `task.md` through `parseTaskDocument`.
  - Reject unindexed or unsafe paths using existing `components/ralph/src/roots.ts`, `path-boundary.ts`, and `task-paths.ts`.
  - Provide bounded pagination for model results.
- Add `components/operations/src/ledger-tool.ts` with bounded `list`, `inspect`, `select`, `clear`, and `mutate_work_items` actions.
- Selection appends only the canonical root/path pointer. Clearing appends a tombstone.
- Work-item mutations return before/after digests and typed progress and call `mutateTaskWorkItems`.

### Services and unified operations runtime

- Add `components/review/src/operations-service.ts` and `components/ralph/src/operations-service.ts` using the existing event-bus discovery pattern from `components/subagents/src/service.ts`. Each exposes active progress subscriptions, authorized receipt queries, ownership classification, controller-owned stop, and `stopAll`.
- Ownership must distinguish: active and owned by this controller; active in another process/session; nested under Ralph; non-live/stale receipt.
- Add `components/operations/src/index.ts` and `extensions/harness.ts`:
  - Register `/harness`, `/ledger`, and the `ledger` model tool after Review and Ralph in `package.json`.
  - Include `components/operations/src/` in `package.json` files and `tsconfig.json`.
  - Add `components/operations/tests/**/*.test.ts` to `vitest.config.ts`.
  - Merge live progress with recent receipt rows only after known-root validation.
  - Recheck ownership after destructive confirmation, call only the owning controller, and await quiescence.

### Shared versus domain-specific UI

Add `components/operations/src/ui/` and copy interaction quality from existing apple-pi TUIs, not their public-agent semantics.

Shared primitives:

- `hub.ts`: tabbed overlay (Ledger / Ralph / Review), preserved per-view selection, focus routing, lifecycle. Pattern source: `QuestionnaireDialog` tabs plus `FleetList` overlay options.
- `bounded-lines.ts`: ANSI-safe width and height clamping. Pattern source: `truncateToWidth` use in `AgentWidget` and `ExecActivityWidget`.
- `detail-view.ts`: scrollable overlay shell, configured keybindings, two-press or explicit-confirm stop, stay-open after completion. Pattern source: `ConversationViewer` lifecycle without steering or session identity.
- `compact-widget.ts`: one factory widget for active-task plus live Review/Ralph. Pattern source: `AgentWidget` / `ExecActivityWidget` (`requestRender`, spinner, linger, no global key handler).
- `tool-renderers.ts`: compact partial cards and expanded finals. Pattern source: `extensions/runtime-ui.ts`.

Domain projections:

- `ledger-view.ts`: focused `Input` query, `fuzzyFilter` / `fuzzyMatch` over task ID, title, and path, rebuilt `SelectList` that preserves the selected task ID. Do not use `SelectList.setFilter()`. Show status, WI counts, active/stale, inspect/select/clear/start/run.
- `review-view.ts`: live and persisted runs with cycle timeline, partitions, focuses, coverage, findings and verification, meta-review, residuals, usage, receipt path, ownership-aware stop.
- `ralph-view.ts`: bounded multi-root fleet with workspace/ledger/task identity, stage/iteration, objective/gate, WI progress, nested Review panel, usage, receipt path, Ralph-owned stop.

Reuse Pi `SelectList`, `Input`, `ScrollView` or equivalent overlay scrolling, theme helpers, and injected keybindings. Do not import `ConversationViewer` or public fleet types.

Exact interaction:

- Left/right or Tab changes views while preserving each view's selection.
- Configured selection keys and page keys navigate lists/details.
- Enter opens a selected row or confirms an action.
- `/` focuses the Ledger fuzzy query.
- Escape clears focused search, returns from detail/action state, then closes the hub.
- Stop/remove/clear requires explicit confirmation; no single accidental key is destructive.
- The compact widget is render-only and registers no global terminal-input handler.

### Entrypoints, modes, and documentation

- Update `components/review/src/index.ts` and `components/ralph/src/index.ts` to keep explicit actions, route argument-less TUI commands to contextual hub views, replace string widgets with the shared factory widget, stream throttled structured `onUpdate` snapshots, and append validated operation pointers after successful actions.
- Non-TUI modes must never call overlay, widget, or terminal-input APIs. Explicit commands/tools still execute and return bounded text/structured results.
- On session switch/shutdown, first call Review/Ralph `stopAll` and await quiescence, then dispose overlay, subscriptions, refresh jobs, timers, widget, and status keys idempotently.
- Update `README.md`, `docs/ledger.md`, `docs/review.md`, and `docs/ralph.md` with exact controls, branch-pointer semantics, stale roots, WI authority, receipt/error behavior, and non-TUI behavior.

## Sequence

1. **Characterize existing authority.** Add or extend tests for explicit commands/tools, foreign lease refusal, stop quiescence, receipt listing, internal-agent filtering, and current work-item APIs. Confirm current tests pass before changing interfaces.
2. **Build catalog and branch-state logic without UI.** Implement canonical catalog, active-task pointer folding, operation pointers, tombstones, stale validation, and no-global-scan known roots. Register and test model ledger actions against `parseTaskDocument` and `mutateTaskWorkItems`.
3. **Add typed controller progress.** Publish Review and Ralph snapshots at durable transitions and sanitized activity updates. Include cycle/partition/focus state, nested Review projection, and immediate replay.
4. **Add safe per-run receipt rows and operation services.** Preserve old list-function behavior while exposing load-error rows to the hub. Verify only validated root-local receipt namespaces are enumerated.
5. **Add shared UI primitives and the live compact widget.** Match AgentWidget/ExecActivityWidget quality: factory component, spinner, elapsed, theme invalidation, width clamp, linger, disposal. No domain overlay yet.
6. **Add the Ledger fuzzy picker and actions.** Every action calls catalog, `mutateTaskWorkItems`, or existing controller authority.
7. **Add the Review projection and partial tool rendering.** Merge live snapshots with validated persisted rows. Show cycles, partitions, focuses, verification, and meta-review. Preserve open detail after completion. Restrict stop to locally owned standalone Review runs.
8. **Add the Ralph fleet and nested Review projection.** Support multiple validated branch-local roots. Nest independent review under the Ralph iteration. Stop only through the owning Ralph controller.
9. **Finish lifecycle, packaging, modes, and docs.** Register `extensions/harness.ts`, update `package.json`, `tsconfig.json`, `vitest.config.ts`, and `tests/package-load.mjs`. Run the complete acceptance suite and package checks.

The gated-work-item bootstrap is already `done` and is not an implementation step of this plan.

## Acceptance And Backpressure

Map every AC to production behavior and a falsifying check. Tests live under the owning component.

- **AC-001:** `components/review/tests/review-progress.test.ts` must fail unless progress shows current cycle and cap, planner status, queued/running/completed/failed focuses, partition coverage, bounded activity, findings, elapsed timestamps, policy, and usage with strictly increasing sequences and no internal IDs.
- **AC-002:** `components/operations/tests/operations-review-view.test.ts` must navigate live and persisted cycle/partition/focus/finding/verification/meta-review/failure/receipt details, preserve an open detail after completion, reject foreign/nested stop, and prove owned stop waits for terminal receipt and child quiescence.
- **AC-003:** `components/operations/tests/operations-ralph-view.test.ts` must load two branch-authorized linked roots, retain separate workspace/ledger/task identities, display stage/iteration/objective-or-gate/WI/usage state, nest Review correctly, and stop only through the owning Ralph controller.
- **AC-004:** `components/ralph/tests/ralph-catalog.test.ts` must prove status/title come from `task.md`, reject unindexed or unsafe paths, fuzzily match non-prefix title/path fragments, and expose inspect/select/start/run actions without duplicating task state.
- **AC-005:** `components/operations/tests/ledger-session-state.test.ts` must cover divergent branches, tombstones, malformed custom entries, reload/fork/resume/tree restoration, stale deleted/moved/unindexed/malformed/unrelated targets, exact pointer keys, and no custom-entry model context. A stale latest valid pointer must not fall back.
- **AC-006:** catalog, session-state, Ralph-view, and focused ledger-tool tests must prove every WI display and mutation uses `parseTaskDocument` / `mutateTaskWorkItems`, preserves their errors and lease authority, and reflects receipt/closure state without a second interpretation. The bootstrap task's own evidence remains the oracle for parser, role, receipt, and closure semantics.
- **AC-007:** `components/operations/tests/operations-hub.test.ts` must sweep narrow widths/heights, theme invalidation, configured keys, search/detail focus, confirmation, terminal transition, and disposal. Non-TUI tests must throw if overlay/widget/input APIs are attempted while commands/tools still complete.
- **AC-008:** review-progress, `components/ralph/tests/ralph-progress.test.ts`, and `components/operations/tests/operations-tool-rendering.test.ts` must verify immediate replay, monotonic sequence, immutable identity, unsubscribe, mismatch/regression reporting, listener-error isolation, throttled partial updates, cancellation, restoration, and lifecycle cleanup. Extend `components/subagents/tests/subagent-runner-e2e.test.ts` so live internal harness records remain unreachable through all public controls.
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

- **Stale review vocabulary:** implementing “semantic groups” would invent a domain the controller no longer has. Project cycles, partitions, and focuses.
- **Thin UI:** string `setWidget` arrays and text dumps fail the richness contract even if the fields exist. Live factory widgets and navigable overlays are required.
- **Branch leakage:** fold only `getBranch()`. No process-global selected-task state.
- **Global receipt discovery:** begin only with the current trusted root plus validated active-branch operation pointers.
- **Silent receipt loss:** hub enumerators must keep per-run load-error rows without changing contextual list functions.
- **False fuzzy compliance:** `SelectList.setFilter()` is prefix-only. Ledger tests must require a non-prefix fuzzy match.
- **Stale fallback:** choose the latest structurally valid pointer before filesystem validation; stale validation must not resurrect an older pointer.
- **Authority duplication:** catalog, ledger actions, and UI must consume `parseTaskDocument` and `mutateTaskWorkItems`.
- **Nested stop bypass:** a Ralph-owned Review cannot expose standalone Review stop.
- **Progress races:** assign sequence synchronously per run and reject immutable-identity changes in projection state.
- **Internal-agent leakage:** strip child IDs, prompts, session paths, transcripts, raw arguments, and raw model text, including fields already stored on receipts.
- **TUI affecting work:** rendering/subscriber errors must be caught and reported without aborting a controller or altering receipts.
- **Lifecycle leaks:** stop/quiesce before disposing every listener, refresh job, timer, widget, status key, and overlay.
- **Argument-less command change:** `/review` today starts a workspace run. Routing the empty command to the hub is intentional and must keep ` /review run` as the explicit launch path.
- **Scope creep:** do not redesign budget arithmetic, broadly reorganize controllers, or perform unrelated formatting/convergence work.

## Integration Points

- Pi branch persistence: `pi.appendEntry(...)` and `ctx.sessionManager.getBranch()`.
- Pi TUI: `ctx.mode === "tui"` gates overlays/widgets; use `Input`, `SelectList`, overlay `custom()`, `fuzzyFilter`/`fuzzyMatch`, injected keybindings, and theme callbacks.
- Tool streaming: Review and Ralph use throttled structured `onUpdate`; renderers distinguish partial from final output.
- Event bus: Review, Ralph, and harness services follow `getManagedSubagentService` discovery.
- Root security: reuse `components/ralph/src/roots.ts`, `path-boundary.ts`, and `task-paths.ts`.
- Work items: `parseTaskDocument`, `WorkItemMutation`, `mutateTaskWorkItems`.
- Stop authority remains in Review/Ralph controllers and their existing lease/receipt paths.
- Progress is ephemeral; only controller receipt append functions and explicit WI outcome fields persist.
- UI/catalog state is always derived from indexed `task.md` content and expected digest.

## Rollback Or Recovery

- Controller subscriptions, services, renderers, and the hub are additive and can be disabled independently. Explicit Review/Ralph commands/tools and receipts remain available.
- Pointer entries are append-only and outside model context. Recovery appends tombstones; it never rewrites session JSONL.
- Additive receipt fields require no bulk migration. Existing Review schema-v1 and Ralph schema-v2 runs load without UI fields; Ralph schema-v1 remains audit-only.
- If UI initialization fails, remove the hub/widget projection while preserving semantic gates, explicit operations, and receipts.
- Recover stale tasks/roots only by explicit clear/remove/reselect after validation. Never repair paths, select replacements, or claim leases automatically.
- Recover projection sequence/identity errors by reopening and replaying current controller snapshots plus authorized receipts; never mutate task/run state from the projection.

## Related Records

The gated-work-item prerequisite is represented only by the root task's `Depends-On` edge.

- `.ledger/202608151813-build-harness-operations-ui/decisions/interaction-model.md`
- `.ledger/202608151813-build-harness-operations-ui/specs/active-task.md`
- `.ledger/202608151813-build-harness-operations-ui/specs/operations-hub.md`
- `.ledger/202608151813-build-harness-operations-ui/research/current-state.md`
- `.ledger/202608151813-build-harness-operations-ui/research/current-state-2026-08-16.md`

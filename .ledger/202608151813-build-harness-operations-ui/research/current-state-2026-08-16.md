Status: done
Created: 2026-08-16
Updated: 2026-08-16

# Current harness UI and review-domain state

## Question

What of the 2026-08-15 operations-hub investigation still holds after the review rewrite, work-item bootstrap, and TypeScript layout convergence, and which in-repo TUI patterns should the hub match?

## Sources

- `components/review/src/index.ts`
- `components/review/src/controller.ts`
- `components/review/src/types.ts`
- `components/review/src/receipts.ts`
- `components/ralph/src/index.ts`
- `components/ralph/src/controller.ts`
- `components/ralph/src/types.ts`
- `components/ralph/src/task.ts`
- `components/ralph/src/task-document.ts`
- `components/ralph/src/receipts.ts`
- `components/subagents/src/service.ts`
- `components/subagents/src/activity.ts`
- `components/subagents/src/ui/agent-widget.ts`
- `components/subagents/src/ui/fleet-list.ts`
- `components/subagents/src/ui/conversation-viewer.ts`
- `components/ask-user-question/src/dialog.ts`
- `extensions/runtime-ui.ts`
- `docs/review.md`
- `docs/ralph.md`
- `docs/ledger.md`
- `docs/development.md`
- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- `tests/package-load.mjs`
- Installed Pi 0.84.2 `docs/tui.md` and `docs/extensions.md`
- `.ledger/202608151813-build-harness-operations-ui/research/current-state.md`

## Method

Re-read the current Review and Ralph entrypoints, run types, controllers, receipts, and work-item APIs. Compared them to the 2026-08-15 research and the still-active operations specs. Inspected the live subagent, Pi Exec, and questionnaire UIs as the richness bar. No interactive TUI session was run.

## Findings

- Review is no longer a one-shot planner that emits semantic groups. `ReviewController` now runs profile-bounded cycles. Each cycle has a planner that opens file partitions and concrete focuses, parallel reviewers for those focuses, then one verifier plus meta-review. Coverage, findings, notes, residuals, and receipts are cycle/partition/focus-scoped.
- Review and Ralph still install two-line `setWidget` string arrays at start and replace them only when the promise settles. `_onUpdate` is unused. There is still no `subscribeProgress`, no live factory widget, and no hub overlay.
- Controllers still keep private `active` maps. Ralph still owns a nested `ReviewController` and treats independent review as a `reviewing` stage. Nested review stop remains a Ralph stop.
- Gated work items already exist. `parseTaskDocument` is the parser. `mutateTaskWorkItems` is the leased digest-checked mutation API. Ralph receipts already carry proposal/judgment/confirmed/rejected envelopes. The operations task must consume these APIs, not reimplement them.
- Catalog, active-task pointers, `/ledger`, `/harness`, and `components/operations` still do not exist.
- Public subagent filtering is unchanged: `internalOwner` and parented records stay out of `AgentWidget`, `FleetList`, and public resume/steer/stop. `ManagedAgentRequest` still has usage/compaction/`onStarted` hooks but no sanitized activity callback for harness roles.
- Receipt listing behavior is unchanged: `listReviewRunSummaries` silently omits corrupt runs; Ralph `listRunSummaries` skips schema-v1 audit-only runs and throws on current-schema load errors. The hub still needs safe discriminated enumeration without changing those contextual contracts.
- Tests and sources now live per component (`components/<name>/{src,tests}`). Root `tests/` is for package-load and cross-component integration only. The 2026-08-15 plan's `tests/*.test.ts` paths are stale.
- In-repo richness already exists and is the interaction bar:
  - `AgentWidget`: factory widget, `requestRender`, spinner timer, themed glyphs, width clamp, linger after completion.
  - `FleetList`: below-editor navigable roster, empty-prompt activation, overlay detail, editor-focus gating, selection preserved across completion.
  - `ConversationViewer`: scrollable overlay, configured keybindings, two-press stop, stays readable after the run ends. Steering and public session identity are not reusable for harness roles.
  - `ExecActivityWidget` / `renderExecResult`: compact live rows, expanded tool cards, partial vs final, elapsed time, status glyphs.
  - `QuestionnaireDialog`: tabbed overlay, Focusable input, themed SelectList, explicit finish.
- `/review` with no arguments currently defaults to `run`. `/ralph` with no arguments currently defaults to `status` and notifies a text summary. Opening the hub from those argument-less commands remains the ratified entrypoint change.
- Pi APIs used by the old plan remain current in 0.84.2: `ctx.mode === "tui"`, `ctx.hasUI`, `ctx.ui.custom` overlays, factory `setWidget`, `appendEntry` / `getBranch()`, `fuzzyFilter` / `fuzzyMatch`, and prefix-only `SelectList.setFilter()`.

## Conclusion

The product decision is still one branch-scoped operations hub over ledger records, controller progress, and receipts. Implementation must target the current review domain (cycles, partitions, focuses, verifier, meta-review) and must match the existing apple-pi TUI quality rather than two-line status text. Work-item authority is already done and is a consumption boundary.

## Limits

No interactive TUI session was run. Widget, overlay, and focus findings come from source and current Pi 0.84.2 documentation.

## Related Records

- `.ledger/202608151813-build-harness-operations-ui/research/current-state.md`

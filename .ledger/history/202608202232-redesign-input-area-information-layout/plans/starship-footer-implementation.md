Status: done
Created: 2026-08-20
Updated: 2026-08-20

Superseded before implementation by the user-approved Zentui input-card direction. It remains a source-backed record of the rejected footer-only approach and its telemetry findings.

# Starship footer implementation plan

## Outcome

Install one Apple Pi-owned, ANSI-safe, responsive Starship footer in TUI mode. It replaces Pi's native footer only when the bounded Pi 0.84.x private telemetry capture succeeds, preserves public Git/status data and all existing widgets, retains native `(sub)` and `(auto)` qualifiers, and leaves the native editor unchanged.

## Current-System Evidence

- `package.json` publishes the root `extensions/` directory, declares eleven extension entrypoints, and has no status-footer component or entrypoint.
- `tests/package-load.mjs` enumerates that same entrypoint list and asserts an extension count of 11.
- Pi's `ExtensionUIContext.setFooter()` factory receives `ReadonlyFooterDataProvider`; its supported read-only surface is `getGitBranch()`, `getExtensionStatuses()`, `getAvailableProviderCount()`, and `onBranchChange()` (`dist/core/footer-data-provider.d.ts`). Interactive `setStatus()` already calls `requestRender()` (`dist/modes/interactive/interactive-mode.js`).
- Pi's native footer is the behavioral source for session totals, cache metrics, context threshold colors, subscription detection, and auto-compaction label (`dist/modes/interactive/components/footer.js`). `ExtensionContext` supplies current model, thinking, context usage, cwd, and session-manager branch data through lazy getters (`dist/core/extensions/runner.js`).
- The custom footer example uses a factory-local `footerData.onBranchChange()` subscription and returns it from `dispose()` (`examples/extensions/custom-footer.ts`).
- Exact `(sub)` and `(auto)` values require the decision-recorded, one-shot private capture of `InteractiveMode.session` while `InteractiveMode.setExtensionFooter()` installs the exact factory. That method synchronously invokes the factory and Pi exports `InteractiveMode` from the package root, but the method is private in the type surface.

## Change Surfaces

1. **`components/status-footer/src/` (new):** Own the footer installer, private capture, telemetry snapshotting, segment formatting, layout packing, and narrow `index.ts` export. Keep ANSI-visible-width and truncation logic beside the production renderer rather than a generic UI utility.
2. **`components/status-footer/tests/` (new):** Test snapshot-to-lines behavior and capture lifecycle with a footer-data/TUI harness; do not mirror a static documentation inventory.
3. **`extensions/status-footer.ts` (new):** Thin package entrypoint re-exporting the component installer.
4. **`package.json`:** Publish the new component source and register the extension after existing UI status producers so it becomes this package's sole footer owner.
5. **`tests/package-load.mjs`:** Add the intentional entrypoint and adjust its expected extension count while preserving any unrelated existing edits.
6. **`README.md` and `docs/status-footer.md` (new):** Catalog the TUI-only Starship footer, exact information boundary, no-config design, Pi 0.84.x private compatibility boundary, and native-footer fallback behavior.

## Sequence

1. Implement pure footer data/format/layout functions around a rendering snapshot. Read current values at render time: path/session name from `ctx.sessionManager`, model/thinking/context from the lazy `ExtensionContext`, Git/statuses from `ReadonlyFooterDataProvider`, and native-equivalent usage totals from active branch entries. Preserve native semantics for input, output, cache read/write, cache hit rate, cost, subscription, and context warning/error thresholds.
2. Implement deterministic layout tiers without raw-column breakpoints: align identity and telemetry when they fit; reflow to two rows; then remove lower-priority segments and apply ANSI-safe truncation/omission. Keep all live statuses as the highest-priority group after identity/model/context, with known Apple Pi keys ordered first and unknown keys retained.
3. Implement the footer component factory. Subscribe to `onBranchChange()` and request a render; dispose that subscription. Use current context getters in `render()`, do no background polling, and return no empty status row.
4. Implement the private bridge in a dedicated, explicitly named module. In a TUI `session_start` handler, synchronously intercept only `InteractiveMode.prototype.setExtensionFooter` for the exact factory identity; capture/validate the live session, delegate exactly once, and restore the method in `finally`. On a missing runtime shape or failed capture, do not call the custom factory, preserve the existing footer, and notify the user that the native footer remains active. Do not patch `FooterDataProvider`, `AgentSession`, or a persistent global session reference.
5. Wire the component through the new thin extension entrypoint, manifest, and loader test. Do not register commands, configuration, widgets, editor components, or additional status producers.
6. Add the user-facing documentation only for the behavior actually shipped. State that native editor and existing widgets remain independent; do not imply that the custom footer exists in RPC mode.
7. Run focused unit/loader/type checks while iterating, then the required repository sequence. Manually inspect a TUI session at wide, reflow, and narrow widths plus Advisor/MCP/subagent activity if an interactive terminal is available; otherwise record it as not verified.

## Acceptance And Backpressure

| Criterion | Class | Production surface | Falsifying check |
| --- | --- | --- | --- |
| AC-001 | Production behavior | Snapshot formatter and responsive renderer | Wide render contains identity, model/thinking, Git, context/cost, usage/cache, and status rows in the specified hierarchy. |
| AC-002 | Invariant | Status projection/layout plus footer factory | Harness changes MCP/Advisor/subagent/unknown status map and asserts current text appears once; widgets/editor are never registered or cleared. |
| AC-003 | Invariant | ANSI-aware packing helpers | Parameterized widths with colored segments assert each `visibleWidth(row) <= width`, required high-priority data survives before telemetry, and omitted content is marked. |
| AC-004 | Lifecycle invariant | Installer and private bridge | Fake `InteractiveMode` capture proves exact-factory-only interception, immediate restoration on success/throw, branch subscription cleanup, live model/session reads, and fallback with no custom installation. |
| AC-005 | Boundary invariant | TUI guard in installer | RPC harness asserts it does not invoke the private bridge, `setFooter`, `setEditorComponent`, or alter status/widget calls. |
| Documentation | Documentation evidence | README and `docs/status-footer.md` | Review text against the active specification; it is not evidence that rendering works. |
| Live TUI | Runtime evidence | Installed checkout | Observe wide/medium/narrow layout and asynchronous MCP/Advisor/subagent updates. Not satisfied by unit tests. |

## Risks And Failure Modes

- **Private Pi seam changes:** Package source targets Pi 0.84.2 only. Runtime guards must retain the pre-existing footer and show a clear warning rather than a partial custom footer. Revisit peer-version policy during implementation if packaging cannot accurately represent that supported boundary.
- **Session replacement/reload:** A captured session must not outlive the footer instance. Session-start installation and factory disposal must replace/unsubscribe cleanly; test the bridge's one-shot restoration.
- **Stale live state:** Context getters are lazy and core `setStatus()` requests a render, but tests must exercise live map/model changes rather than assume a render-time snapshot stays current.
- **Terminal correctness:** ANSI styling and Unicode separators make string length invalid. Use Pi TUI `visibleWidth`/`truncateToWidth` exclusively for all width decisions.
- **Existing worktree changes:** Preserve unrelated work, especially any existing change to `tests/package-load.mjs`; inspect its current diff before editing and make a focused additive change only.
- **Footer ownership conflict:** Pi supports only one custom footer. This package intentionally owns its footer; an external later-loaded footer can replace it. Do not attempt an unsupported footer-composition layer.

## Integration Points

- Package extension discovery and tarball inclusion: `package.json`, `tests/package-load.mjs`, `npm run pack:check`.
- Existing live state: Advisor `q-advisor`, MCP `mcp`/authentication text, subagent `subagents`; detailed `agents`, FleetView, and `pi_exec` widgets remain untouched.
- Pi 0.84.2 public data: `ExtensionContext`, `ReadonlyFooterDataProvider`, `@earendil-works/pi-tui` width utilities.
- Pi 0.84.2 private exception: `InteractiveMode`, `AgentSession`, and `ModelRuntime`, as bounded by `../decisions/private-telemetry-bridge.md`.

## Rollback Or Recovery

Removing the new manifest entry or restoring `ctx.ui.setFooter(undefined)` returns Pi to its built-in footer. During an unsupported runtime, the bridge performs no custom installation so the existing footer remains. No migration, persisted configuration, or user data cleanup is required.

## Related Records

- `../task.md`
- `../specs/starship-footer.md`
- `../decisions/starship-footer-owner.md`
- `../decisions/private-telemetry-bridge.md`
- `../research/ui-layout-references.md`

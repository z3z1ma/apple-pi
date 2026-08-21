Status: done
Created: 2026-08-20
Updated: 2026-08-20

# Zentui input-card implementation plan

## Outcome

Replace the rejected footer-only prototype with one width-safe Zentui-style `CustomEditor` card and an empty footer in Pi 0.84.x TUI mode. The card preserves Pi editing behavior while presenting prompt, unlabelled model/provider metadata, a divider, and a concise status/Starship strip in a single composed frame. It uses the one authorized private bridge only for native `(sub)` and `(auto)` parity.

## Current-System Evidence

- `CustomEditor.render(width)` renders a top rule, prompt lines, a bottom rule, and autocomplete output; it supplies normal input, paste, submission, keybinding, and cursor behavior. The upstream `border-status-editor.ts` example replaces its top/bottom border rows after `super.render(width)` and uses `visibleWidth`/`truncateToWidth`.
- `CustomEditor` is exported from `@earendil-works/pi-coding-agent`; the documented modal example delegates non-modal input through `super.handleInput()`.
- Existing apple-pi status producers remain `mcp`, `q-advisor`, and conditional `subagents`; detailed agent/Fleet/Pi Exec views are separate widgets and must not move into the card.
- Pi's native footer is the source for usage totals and native subscription/auto-compaction semantics. Its totals iterate `sessionManager.getEntries()`—assistant, tool-result, branch-summary, and compaction usage—not merely the current branch.
- The task's current untracked `components/status-footer` prototype is a rejected footer-only renderer. Its private bridge and whole-session usage helper may be retained only if they meet the new card contract; its diagnostic field-label renderer and footer-only installer must be removed.
- `package.json`, `tsconfig.json`, `vitest.config.ts`, and `tests/package-load.mjs` already contain unrelated workflow changes. Preserve those changes and make only additive status-card adjustments after inspecting the exact current diff.

## Change Surfaces

1. **`components/status-footer/src/ui/input-card.ts` (new) and current footer UI removal:** Implement a `CustomEditor` subclass and pure strip/card layout helpers. Call `super.render(width)`, replace the normal top/bottom rules with ANSI-safe rounded frame/divider/strip rows, and preserve autocomplete rows rather than treating them as card metadata.
2. **`components/status-footer/src/usage.ts` (retain/refine):** Keep native-equivalent accounting over `getEntries()` and test assistant, tool-result, branch-summary, and compaction contributions.
3. **`components/status-footer/src/bridge.ts` (retain/refine):** Capture only the current `AgentSession` during exact empty-footer installation; immediately restore the private prototype. Its valid result becomes a prerequisite for both the empty footer and card installation.
4. **`components/status-footer/src/installer.ts`, `types.ts`, and `index.ts`:** Replace footer-only installation with the card-plus-empty-footer transaction. Guard TUI mode, do not replace an unsupported pre-existing editor/footer, and issue an honest warning on bridge/editor incompatibility.
5. **`components/status-footer/tests/`:** Replace rejected footer snapshot tests with card rendering, `super.handleInput()` delegation, narrow-width, live branch/status, empty-status, native usage, bridge restoration, and RPC/no-install behavior tests.
6. **`extensions/status-footer.ts`, `package.json`, `tsconfig.json`, `vitest.config.ts`, and `tests/package-load.mjs`:** Retain a thin entrypoint, publish/register the component, include test paths, and update the loader's explicit list/count without overwriting the independent workflow entry changes.
7. **`docs/status-footer.md` (new) and `README.md`:** Document the TUI-only card, Pi 0.84.x private compatibility boundary, status/widget preservation, native working-line boundary, and custom-editor ownership limitation. Do not document unshipped configurability.

## Sequence

1. Remove the rejected diagnostic footer renderer and write pure snapshot/segment helpers for the new card. Use `ctx.model.name` and provider display text for the metadata zone; do not expose `model:`, `provider:`, `project:`, `thinking:`, `ctx:`, or `cost:` labels.
2. Build the Starship strip as two measured groups: project/path/branch plus ordered live producer text on the left; context `(auto)`, token/cache traffic, and cost `(sub)` on the right. Preserve producer text; known apple-pi keys order first and unknown keys remain visible. At pressure, reflow the strip once and drop only the specified low-priority detail with a single visible omission marker.
3. Implement the card editor subclass with `super(tui, theme, keybindings, { paddingX: 1 })`, unchanged `handleInput(data) { super.handleInput(data); }`, and a `render(width)` that transforms only the core editor border rows. Keep autocomplete rows returned by `super.render()` after the card and do not add terminal-input listeners or timers.
4. Pair the empty-footer factory and editor factory in the installer. Before bridge installation, record the existing editor factory and reject a non-default custom editor without any replacement; do not attempt generic editor composition. Then use the one-shot bridge to validate/capture session. Pi has no custom-footer getter or transaction, so a successful card is intentionally the last custom-footer owner. If capture fails, make no replacement; if card creation fails after empty-footer installation, restore the built-in footer and report that an arbitrary earlier custom footer cannot be recovered.
5. Exercise actual status map/branch reactivity through a card-held `footerData.onBranchChange()` subscription and the normal Pi redraw path for status updates. Dispose subscriptions with the editor/footer replacement lifecycle.
6. Update focused unit tests, manifest/loader integration, and user-facing docs. Re-run formatting on only touched TypeScript/Markdown paths.
7. Run focused checks, then repository quality checks. Run a real TUI session at generous, medium, and narrow widths if available; observe MCP, Advisor, and subagent transitions. If a live terminal observation is unavailable, report it `Not verified` rather than claiming visual parity from snapshots.

## Acceptance And Backpressure

| Criterion | Class | Production surface | Falsifying check |
| --- | --- | --- | --- |
| AC-001 | Production behavior | Card editor render and strip layout | Render harness asserts a rounded frame, prompt zone, unlabelled model/provider line, divider, and compact prose-like strip; rejected prefixes are absent. |
| AC-002 | Invariant | Status projection and installer | Mutate MCP/Advisor/subagent/unknown status map and assert each current text appears once in the card while no widget/editor status producer is cleared or replaced. |
| AC-003 | Invariant | Card/strip packing | Parameterize ANSI-colored snapshots and small widths; assert `visibleWidth(row) <= width`, no unbounded telemetry rows, and priority/omission behavior. |
| AC-004 | Lifecycle invariant | Custom editor, bridge, and installer | Assert `handleInput` delegates to base behavior, autocomplete rows survive, exact-factory bridge restores on success/failure, incompatible editor causes no replacement before bridge installation, capture failure leaves UI untouched, and later card construction restores the built-in footer. |
| AC-005 | Boundary invariant | TUI guard | RPC harness asserts no private bridge, `setFooter`, or `setEditorComponent` call. |
| Documentation | Documentation evidence | README and docs page | Review against active spec; does not prove UI behavior. |
| Live TUI | Runtime evidence | Installed checkout | Observe actual card shape and asynchronous producer transitions at wide/medium/narrow widths. Not satisfied by snapshot tests. |

## Risks And Failure Modes

- **Card geometry:** `super.render()` may include autocomplete rows after its bottom border. Transform only the known editor core rows; preserve subsequent rows unchanged.
- **Input compatibility:** A custom editor must preserve the base input handler and cannot safely compose arbitrary third-party editor factories. Fail visibly rather than stack competing editor implementations.
- **Private bridge and footer ownership:** The bridge is version-sensitive. Capture failure must preserve the existing editor/footer, but Pi cannot transactionally restore an earlier custom footer after empty-footer delegation. Detect existing custom editors first, document normal last-footer-owner semantics, and recover a later card-construction failure to the built-in footer only.
- **Producer verbosity:** MCP and Advisor are intentionally persistent. The renderer may compact only its own presentation, not discard or invent their state; unknown extension statuses remain displayable.
- **Terminal accessibility:** Every semantic state uses readable text as well as theme color. ANSI widths, not string lengths, control all border/segment fitting.
- **Existing modifications:** Preserve independent workflow/ledger work and edit the package loader as a minimal reconciliation, never as a rewrite.

## Integration Points

- Pi 0.84.2: `CustomEditor`, `ExtensionContext`, `ReadonlyFooterDataProvider`, `InteractiveMode`, `@earendil-works/pi-tui` width tools.
- Existing apple-pi producers: Advisor `q-advisor`, MCP `mcp`/authentication state, and subagent `subagents`; Agent/Fleet/Pi Exec widgets remain independent.
- Package boundary: explicit extension manifest/list, `files`, TypeScript/Vitest includes, loader smoke test, npm dry run.

## Rollback Or Recovery

If the card cannot install, leave the existing editor and footer in place. Removing the status-footer manifest entry restores stock Pi behavior. No persisted configuration, session migration, or data cleanup is involved.

## Related Records

- `../task.md`
- `../specs/zentui-input-card.md`
- `../decisions/zentui-input-card-owner.md`
- `../decisions/private-telemetry-bridge.md`
- `../research/ui-layout-references.md`

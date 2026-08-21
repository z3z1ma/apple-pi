Status: done
Created: 2026-08-20
Updated: 2026-08-20

# Input-area layout reference assessment

## Question Or Hypothesis

Can apple-pi replace Pi's default input-area information layout with a responsive, status-preserving design inspired by Zentui and selected Powerline presentation patterns, without importing either extension's unrelated product behavior or relying on Pi internals?

## Motivation

The existing default footer has useful but visually flat information: project identity, model/thinking, token and cache usage, cost, context, MCP, Advisor, and conditional subagent status. The intended redesign must improve hierarchy without hiding live extension state or taking ownership of unrelated workflows.

## Sources And Methods

- Pi 0.84.2 local documentation and examples, including `docs/tui.md`, `docs/extensions.md`, and `examples/extensions/border-status-editor.ts`, inspected 2026-08-20.
- `https://github.com/lmilojevicc/pi-zentui`, shallow checkout at `309144bb22672cd943ecb110bba4cb4d53cf0c44` (v0.20.1), inspected 2026-08-20. Package metadata declares MIT.
- `https://github.com/nicobailon/pi-powerline-footer`, shallow checkout at `aee1564dfbf347a749af7d4423890e54eae05a79` (v0.15.1), inspected 2026-08-20. Package metadata declares MIT; no root LICENSE file was observed in that checkout.
- `components/advisor/src/extension.ts`, `components/subagents/src/ui/agent-widget.ts`, `components/subagents/src/ui/fleet-list.ts`, and `extensions/runtime-implementation.ts`, inspected to map existing apple-pi state producers.

The source checkouts were temporary `/tmp` research material only, per the user's direction. No third-party source was copied into this repository.

## Findings

### Existing apple-pi information contract

Pi's native footer carries project/session identity, model and thinking level, usage, cache, cost, context, and compaction information. apple-pi and its MCP dependency add the persistent `mcp` and `q-advisor` statuses plus the conditional `subagents` status. Detailed subagent and Pi Exec views are separate above- or below-editor widgets, not footer text.

A replacement footer can obtain the live extension-status map through public `footerData.getExtensionStatuses()` and react to branch changes through `footerData.onBranchChange()`. Complete footer/editor replacement is TUI-only; RPC uses the normal status/widget requests while these custom components are no-ops.

### Zentui

Zentui is the stronger structural reference. Its custom footer uses only the supported footer factory, renders source-aware ANSI-safe rows, preserves third-party statuses by reading the extension-status map, and reflows from aligned zones to at most two rows before using a compact packing strategy. Its implementation explicitly measures ANSI-visible width and truncates every rendered row.

Its full product also owns a broad configuration and visual surface—multiple editor/message styles, OpenCode-oriented metadata, selector decoration, user-message styling, settings UI, and persistence—which is not a reason to copy that architecture. The reusable idea is its information hierarchy and responsive-footer discipline, not its feature inventory or configuration model.

### Powerline

Powerline is a useful presentation reference for placing compact, high-signal information in an editor border, status-segment grouping, preset-like priorities, and a secondary row under width pressure. Its extension-status items demonstrate that Apple Pi's MCP, Advisor, and subagent states can remain visible as named live segments.

It is not a suitable implementation base. Its custom editor also owns a shell mode, queued-prompt store, welcome overlay, commands, widgets, and input interception. It additionally monkey-patches `footerData.setExtensionStatus` and `clearExtensionStatuses` to trigger repaints; those are not part of Pi's documented footer interface and must not be adopted.

### Official Pi pattern

The upstream `border-status-editor.ts` example proves the needed editor-border composition: extend `CustomEditor`, preserve normal input through `super.handleInput()`, hide the native working row, render ANSI-width-safe borders, and end custom working state on `agent_settled` rather than `agent_end`.

## Conclusions

A custom, responsive Apple Pi-owned footer is technically supported and should use Zentui as the primary layout reference. A restrained editor-border status treatment can borrow Powerline's presentation language only if it complements, rather than duplicates, the footer. The implementation must preserve every existing status producer through the public footer-status map and leave existing widgets independent.

## Limits

The user prefers Zentui's direction but has not yet selected a final visual hierarchy or supplied all desired examples. This research does not settle exact colors, separators, border treatment, narrow-width priorities, user configuration, or whether the editor border carries persistent versus transient state. It does not authorize importing third-party source or adding Powerline's shell, queue, welcome, or settings behavior.

## Related Records

- `../task.md`
- `../../../../docs/boundaries.md`

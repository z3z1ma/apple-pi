Status: superseded
Created: 2026-08-20
Updated: 2026-08-20

Superseded by `zentui-input-card.md` after the user selected a Zentui-style input card rather than a footer-only layout.

# Starship-style input footer

## Purpose And Authority

This specification defines the observable TUI presentation that replaces Pi's built-in footer for apple-pi. It is authorized by the user's Zentui-first preference and explicit choice of a Starship footer as the single persistent information surface. It governs the information hierarchy, responsive behavior, and state-preservation boundary; it does not prescribe component structure.

## Actors And Boundaries

- **Pi** supplies the session, model, context usage, working state, and `ReadonlyFooterDataProvider` with current Git branch and extension-status map.
- **apple-pi status producers** supply existing `mcp`, `q-advisor`, and conditional `subagents` text. Pi Exec and detailed subagent views remain widgets outside this footer.
- **The custom footer** reads and presents those sources. It MUST NOT modify their state, infer a success state, or replace their independent widgets.
- **The private telemetry bridge** is a user-authorized Pi 0.84.x TUI-only seam that captures the active `AgentSession` during this footer's synchronous installation. It supplies only the native subscription and auto-compaction qualifiers; it is not a second status source.
- **The native editor** remains unmodified. The footer MUST NOT install a custom editor, intercept input, alter working-indicator behavior, or create an alternate input path.
- **RPC mode** continues to receive ordinary Pi status/widget output. A custom footer is TUI-only and must not create an alternate RPC representation.

## Required Behavior

### Wide layout

When all content fits, the footer renders two semantic rows:

1. **Identity and telemetry:** project path and Git branch on the left; model and thinking level, context usage, token/cache telemetry, session cost/subscription state, and automatic-compaction state on the right.
2. **Live status:** every current extension-status entry, with MCP, Advisor, and subagent information readable as emitted by their producers.

Path and branch form the project anchor. Model/thinking and context are the primary right-side operational signals. Token/cache detail and cost are secondary telemetry. The status row is visually quieter than the identity/telemetry row but must remain legible and textually self-describing.

### Responsive layout

The footer MUST measure ANSI-visible cell widths and never return a row wider than the supplied width.

As room decreases, it MUST preserve this priority order:

1. project identity, active model/thinking, context percentage, and every active status entry;
2. Git branch and session cost;
3. token and cache detail, context-window totals, subscription/auto-compaction qualifiers, and path depth.

The renderer MAY reflow the identity/telemetry content across a second row before omitting lower-priority detail. It MUST then use ANSI-safe truncation and an explicit omission marker rather than splitting escape sequences or silently overflowing. An empty status map MUST NOT render a blank status row.

The renderer MUST preserve status text rather than parsing it into invented state. Known apple-pi statuses MAY be given stable ordering and theme treatment; unknown status keys MUST remain displayable after known entries without being discarded.

### Live updates and lifecycle

The footer MUST render the current extension-status map and current Git branch on every render. It MUST request repaint when Pi reports a Git-branch change and release that subscription when disposed. It MUST rely on Pi's standard footer invalidation/status-update lifecycle rather than monkey-patching `FooterDataProvider` internals.

To retain exact native `(sub)` and `(auto)` qualifiers, the footer MAY use only the one-shot private telemetry bridge defined in `../decisions/private-telemetry-bridge.md`. It MUST capture the current `AgentSession` only while installing its own exact footer factory, restore the intercepted method immediately in `finally`, and read the session's live model-runtime subscription state and auto-compaction state only at render time. If capture is unavailable, it MUST leave Pi's built-in footer installed rather than present incomplete or inferred state.

Session/model/context and status changes MUST be reflected on Pi's normal redraw path; implementation tests must prove the dynamic status and branch cases. The footer must use no independent durable state, no background polling, process-global current-session reference, or stale session-bound callback after replacement or disposal.

### Visual language

Use Pi theme tokens and ANSI-safe separators to create a Starship-like hierarchy: concise grouped segments, intentional whitespace, a calm identity anchor, and clear operational emphasis. Do not add user configuration, custom colors, raw terminal assumptions, Nerd Font requirements, or a second visual system.

## Error And Failure Behavior

- Missing model, context, branch, session name, token/cache, cost, or individual statuses MUST remove only the affected segment; the footer remains valid and truthful.
- Zero or extremely narrow widths MUST return only width-fitting output and must not throw.
- A custom-footer factory failure, unsupported UI mode, private-bridge mismatch, or footer disposal MUST leave Pi's normal editor and status/widget producers usable. A private-bridge mismatch MUST retain Pi's built-in footer. The implementation must not hide a failure through fabricated footer state.
- The footer MUST use documented read-only footer APIs for Git and statuses. Its only private access is the decision-recorded one-shot telemetry bridge; it MUST NOT call or replace `setExtensionStatus` or `clearExtensionStatuses`.

## Given-When-Then Scenarios

- **Given** a wide TUI with project, model, Git branch, token/cache, cost, context, MCP, and Advisor data, **when** the footer renders, **then** it shows a two-row Starship hierarchy without duplicated native-footer rows.
- **Given** an active subagent, **when** its existing producer publishes `subagents`, **then** the footer shows that live status while the detailed agent widget and FleetView keep their current placement.
- **Given** an Advisor review or MCP authentication transition, **when** its producer updates its status, **then** the replacement footer reflects the producer's current text without local state duplication.
- **Given** a narrow terminal, **when** all full-detail segments do not fit, **then** identity, model/thinking, context percentage, and active statuses survive before lower-priority telemetry, and every returned row fits its width.
- **Given** RPC mode, **when** the extension registers, **then** existing status/widget output remains available and no custom-editor behavior is installed.
- **Given** footer replacement or disposal, **when** a later branch/status update occurs, **then** no stale callback updates the retired footer.

## Acceptance Mapping

- AC-001: Wide-layout hierarchy and visual language.
- AC-002: Status preservation, current-text presentation, and unchanged widgets.
- AC-003: Responsive priority, reflow, ANSI-safe width fitting, and empty-row behavior.
- AC-004: Native editor boundary, public API restriction, lifecycle behavior, and dynamic-update tests.
- AC-005: RPC boundary.

## Exclusions

No editor-border bar, queue, shell mode, welcome screen, input interception, user-message styling, persistent settings, third-party source copying, or new runtime dependency belongs to this specification.

## Assumptions And Provenance

- User selected **Starship footer** on 2026-08-20 after a Zentui-first review.
- User selected **Use private Pi internals** on 2026-08-20 after the unavailable native qualifiers were identified; `../decisions/private-telemetry-bridge.md` bounds that exception.
- `research/ui-layout-references.md` records the reference assessment and public-API constraint.
- Pi 0.84.2 declares `getGitBranch`, `getExtensionStatuses`, and `onBranchChange` as the read-only footer data surface. The existing documented `custom-footer.ts` example demonstrates the factory and disposal pattern.

## Related Records

- `../task.md`
- `../research/ui-layout-references.md`
- `../decisions/starship-footer-owner.md`
- `../decisions/private-telemetry-bridge.md

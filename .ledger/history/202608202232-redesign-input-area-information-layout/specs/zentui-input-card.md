Status: active
Created: 2026-08-20
Updated: 2026-08-20

# Zentui-style input card

## Purpose And Authority

This specification replaces `starship-footer.md` as the governing visible contract. The user rejected the footer-only telemetry layout after comparing it with a Zentui reference and selected **Adopt the Zentui card**. The user-provided screenshots are the visual authority: a soft, inset input composition with a calm top rule, unlabelled metadata, a divider, and a compact Starship information strip—not an edge-to-edge telemetry dump or glyph box around the prompt.

## Actors And Boundaries

- **Pi's native editor behavior** remains the input authority. The card is a `CustomEditor` subclass that delegates ordinary editing and unhandled keys to Pi.
- **The input card** is the sole persistent TUI owner for input-adjacent identity, model/provider metadata, telemetry, Git, and extension-status presentation.
- **The replaced footer** renders no rows. It exists only so Pi's native footer does not duplicate information now displayed inside the card.
- **The native working indicator and existing above/below-editor widgets** remain independent. The card does not intercept working state, agent input, Pi Exec activity, detailed agent rows, or FleetView.
- **The private telemetry bridge** remains limited to retrieving the native subscription and auto-compaction qualifiers; its active decision record applies to the card instead of a separate footer.
- **RPC mode** continues to use Pi's normal status/widget requests; neither custom footer nor editor is installed.

## Required Behavior

### Card composition

In TUI mode, the card MUST render a soft, terminal-width input composition around the normal Pi editor content. It has four visual zones in order:

1. a quiet neutral horizontal rule followed by the editable prompt area, with normal Pi cursor, multiline editing, autocomplete, paste, submit, and keybinding behavior;
2. a restrained model/provider metadata line directly beneath the prompt, without `model:` or `thinking:` labels;
3. a quiet divider; and
4. one compact Starship information strip beneath it.

The terminal implementation MUST NOT put the prompt in `│` side rails or use `╭╮/╰╯` glyph-box borders. The rounded outer silhouette in the visual reference is an image/card treatment, not a terminal-glyph requirement.

The information strip uses prose-like, concise segments rather than diagnostic field labels. Its left side anchors project identity and Git branch; its right side shows context, automatic-compaction state, input/output/cache telemetry, and cost/subscription state. It MUST retain native semantics for `(auto)` and `(sub)`.

Live MCP, Advisor, subagent, and unknown extension statuses appear as readable, conditional information-strip segments. They share the left-side project/status group when room permits and reflow into one additional bottom strip only when needed; they do not create an empty row, replace the existing widgets, or become generic `status:` labels.

### Hierarchy and responsiveness

At generous widths the card reads as one deliberate, breathing block across the available terminal width: neutral editor rule and prompt, model/provider line, divider, then an aligned single information strip. The rules MUST use a subdued theme token rather than Pi's thinking-level border color; thinking level remains model metadata, not a tint applied to the whole structure. It MUST NOT use exposed `project:`, `model:`, `thinking:`, `ctx:`, or `cost:` prefixes.

At constrained widths it MAY reflow the bottom information strip into a second row. It MUST retain, in priority order:

1. active extension status text, a recognizable project anchor, active model/provider, and context percentage;
2. Git branch, cost/subscription state, and automatic-compaction state;
3. cache totals, token totals, context-window total, session name, and path depth.

All card borders and content MUST use ANSI-aware visual widths. Each rendered row MUST fit the supplied width, and omitted lower-priority content MUST use a visible omission marker. The renderer MUST be calm at extremely narrow widths rather than emitting a row per telemetry field.

### Lifecycle and preservation

The installer MUST capture the previously configured editor factory before installing its own editor. If there is no compatible way to preserve an already-custom external editor, it MUST not attempt an unsupported editor-composition layer; package documentation must state that the last custom-editor owner wins.

The custom editor MUST call `super.handleInput()` for standard and unhandled input. It MUST not register terminal-input handlers, change the native working indicator, or implement a queue, shell, welcome screen, or persistent settings.

The installer MUST install the card only after the telemetry bridge has captured a valid Pi 0.84.x session. It MUST detect a pre-existing custom editor before it installs the empty footer and leave that editor/UI unchanged with an honest warning; it MUST NOT attempt generic editor composition.

Pi supplies no custom-footer getter or transactional footer/editor replacement. The card therefore follows normal last-custom-footer-owner semantics: its successful installation intentionally replaces any earlier footer. If card creation fails after Pi has replaced the footer, the installer MUST restore Pi's built-in footer, but cannot restore an arbitrary earlier custom footer. Footer and editor replacement/disposal must not retain stale session callbacks.

## Error And Failure Behavior

- Missing model, context, branch, usage fields, or individual statuses remove only their segment; they do not invent replacements.
- Missing or unsupported private bridge state leaves the existing input/footer composition intact, with a warning. A later card-construction failure restores Pi's built-in footer; an earlier custom footer cannot be recovered because Pi exposes no getter or transaction.
- Empty extension statuses do not render an empty strip.
- Narrow or zero widths must not throw, overflow, or leak ANSI controls.
- The card may not recover missing features through a broad catch, fabricated values, or a second input implementation.

## Given-When-Then Scenarios

- **Given** a normal TUI prompt, **when** the card renders, **then** the prompt sits below a neutral rule with model/provider metadata and a compact Starship strip rather than a plain footer row or a terminal-glyph box.
- **Given** an active Advisor, MCP authentication, or subagent, **when** its producer changes status, **then** the current producer text appears once in the card while the existing detailed widgets remain in their placements.
- **Given** a user edits, pastes, submits, or invokes autocomplete, **when** the card is active, **then** Pi's native editor behavior remains available.
- **Given** a medium or narrow terminal, **when** the full strip no longer fits, **then** the card reflows its bottom information before omitting lower-priority telemetry, and every returned row fits.
- **Given** an unsupported Pi runtime or a pre-existing incompatible custom editor, **when** installation occurs, **then** Apple Pi does not replace the current editor/footer and reports the boundary.
- **Given** a pre-existing custom footer with no custom editor, **when** the card installs successfully, **then** the card replaces that footer as Pi's normal last custom-footer owner; this is documented rather than hidden.
- **Given** RPC mode, **when** the extension starts, **then** it does not install a custom editor/footer and existing status/widget output continues.

## Acceptance Mapping

- AC-001: Card composition, elegant information strip, and visual hierarchy.
- AC-002: Conditional live-status placement and unchanged detailed widgets.
- AC-003: Responsive priority, ANSI-aware card and strip fitting.
- AC-004: `CustomEditor` delegation, compatible lifecycle, one-shot telemetry bridge, and editor/footer fallback.
- AC-005: TUI-only installation boundary.

## Exclusions

No footer-only layout, diagnostic field-label design, editor input interception, working-indicator replacement, queue, shell mode, welcome screen, user-message styling, configuration product, third-party source copying, or extra runtime dependency belongs to this contract.

## Assumptions And Provenance

- User selected **Adopt the Zentui card** on 2026-08-20 after reviewing the user-provided Zentui and current-prototype screenshots.
- The user-provided Zentui reference uses a framed editor, model/provider metadata line, divider, and bottom Starship strip; it is visual inspiration, not source-copy authority.
- The upstream Pi `border-status-editor.ts` example establishes the supported `CustomEditor` extension and rendering boundary.
- `../decisions/private-telemetry-bridge.md` remains the sole authorized private seam.

## Related Records

- `../task.md`
- `../research/ui-layout-references.md`
- `../decisions/zentui-input-card-owner.md`
- `../decisions/private-telemetry-bridge.md`

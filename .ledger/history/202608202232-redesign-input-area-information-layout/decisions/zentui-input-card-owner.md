Status: active
Created: 2026-08-20
Updated: 2026-08-20

# Use a Zentui-style input card as the information owner

## Context

The footer-only prototype rendered raw `project:`, `model:`, `thinking:`, `ctx:`, and `cost:` fields across the terminal. The user compared it with Zentui's composed input card and judged the prototype far from the desired quality.

The reference card organizes the input itself, unlabelled model/provider metadata, a divider, and a Starship strip into one calm visual unit. It is materially different from a custom footer beneath Pi's unchanged editor.

## Decision

Supersede the footer-only decision. In TUI mode, apple-pi will use a custom editor card and an empty custom footer. The card owns persistent input-adjacent presentation; the native editor behavior remains inside a `CustomEditor` subclass, and Pi's working row and existing widgets remain separate.

The card will follow Zentui's compositional language—not its OpenCode-specific behavior or source—using a rounded frame, model/provider metadata, a divider, and an unlabelled compact Starship strip. It must not render a diagnostic telemetry dump or create a second information owner.

## Authority And Provenance

- User feedback and visual references, 2026-08-20: Zentui is substantially more elegant than the footer prototype.
- User choice, 2026-08-20: **Adopt the Zentui card**.
- `../specs/zentui-input-card.md`
- Pi 0.84.2 `examples/extensions/border-status-editor.ts`.

## Alternatives Considered

### Refine the footer-only layout

A smaller footer could remove labels and improve spacing, but it cannot reproduce the visual grouping that the user identified as the goal. Rejected by the user's card choice.

### Copy Zentui

Direct source adoption would import an unrelated configuration, editor/message styles, OpenCode-oriented metadata, and maintenance burden. Rejected; only the visual language and public Pi extension pattern may inform the local implementation.

### Powerline-style all-information border

A dense border could embed all telemetry, but it risks a second diagnostic dump and does not match the selected Zentui composition. Rejected.

## Consequences

The previous footer renderer is not an acceptable implementation and must be replaced, not cosmetically patched. The implementation surface now includes a `CustomEditor` subclass and tests for native input delegation, editor/footer atomic installation, and width-safe card rendering.

The one-shot private telemetry bridge remains necessary for exact native `(sub)` and `(auto)` semantics, but it must capture before installing both the empty footer and card. A failed capture preserves the existing UI.

## Limits And Revisit Conditions

This decision is about input-area composition, not a full theme. Revisit only with a user-approved reference that materially changes the card's zones or requests a configurable theme product. Otherwise, improve this one local composition rather than adding alternate layouts.

## Related Records

- `starship-footer-owner.md`
- `private-telemetry-bridge.md`
- `../specs/zentui-input-card.md`
- `../task.md`

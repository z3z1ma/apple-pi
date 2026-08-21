Status: superseded
Created: 2026-08-20
Updated: 2026-08-20

Superseded by `zentui-input-card-owner.md` after the user selected a Zentui-style input card rather than a footer-only layout.

# Use one Starship-style footer as the persistent information owner

## Context

apple-pi currently exposes useful information through Pi's native footer plus keyed extension statuses. Zentui demonstrates a responsive custom-footer design that preserves those statuses through the public footer data surface. Powerline demonstrates appealing dense presentation but couples it to a custom editor and unrelated product features.

The user strongly preferred Zentui's direction and, when asked which surface should own persistent hierarchy, chose **Starship footer**.

## Decision

apple-pi will install one custom Starship-style footer and retain Pi's native editor. The footer is the only persistent owner of project/Git identity, model/thinking, context and cost telemetry, and extension-status presentation.

Powerline may inform compact segment grouping and visual restraint only. No editor-border information bar, input interception, Powerline feature, or third-party source will be adopted. The sole exception to the former public-API boundary is the user-authorized one-shot telemetry bridge recorded in `private-telemetry-bridge.md`; it exists only to preserve native `(sub)` and `(auto)` qualifiers.

## Authority And Provenance

- User direction, 2026-08-20: Zentui-first, selectively inspired by Powerline.
- User choice, 2026-08-20: **Starship footer** as the primary persistent surface.
- `../research/ui-layout-references.md`
- `private-telemetry-bridge.md`
- Pi 0.84.2 `custom-footer.ts` and footer API declarations.

## Alternatives Considered

### Hybrid editor border and footer

A slim editor-border identity/activity bar plus a footer could look like Powerline while retaining Zentui reflow. It was rejected because it creates two persistent information owners, duplicates state, and introduces custom-editor lifecycle and input compatibility risk without a requested editor behavior.

### Editor-border-only status bar

Putting all data in a `CustomEditor` border is visually distinctive and is supported by Pi's upstream example. It was rejected because the user selected a Starship footer, and this approach would suppress the conventional footer location while requiring the most invasive editor replacement.

### Zentui or Powerline adoption

Both projects contain useful ideas, but direct adoption would import unrelated configuration, workflows, UI surfaces, or private API behavior. It was rejected to preserve one local implementation with apple-pi's existing ownership boundaries.

### Keep Pi's native footer

This is the lowest-risk option but does not meet the requested information-layout overhaul.

## Consequences

The implementation can concentrate rendering, measurement, responsive packing, and status preservation in a footer-owned component. It must reproduce the useful native footer signals from documented session/model/context sources and must verify live status repainting instead of borrowing Powerline's internal mutation hook.

The absence of editor replacement narrows compatibility risk: Pi continues to own input, autocomplete, submission, selection, and working-indicator behavior.

## Limits And Revisit Conditions

Revisit only if the user explicitly requests an editor-border treatment or later reference material establishes a concrete benefit that cannot be achieved by the footer. Any such change requires superseding this decision rather than adding a parallel visual owner.

## Related Records

- `../task.md`
- `../specs/starship-footer.md`
- `../research/ui-layout-references.md`

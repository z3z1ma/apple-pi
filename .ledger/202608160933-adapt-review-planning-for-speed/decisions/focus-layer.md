Status: active
Created: 2026-08-16
Updated: 2026-08-16

# Separate cohesive coverage groups from overlapping review focuses

## Context

The existing review graph uses one `ReviewGroup` for both exact selected-item coverage and the single reviewer assignment. That prevents separate fresh-context investigations of different risks in one cohesive change and forces verification to wait behind the whole reviewer stage. PR-AF demonstrates dynamically generated `ReviewDimension` prompts, but its full seven-phase pipeline conflicts with the requested fast loop and duplicates apple-pi controller responsibilities.

## Decision

Retain semantic groups as cohesive review units, not as an exact-once partition. Groups may share selected items when one change belongs in more than one unit. Add a controller-validated, bounded focus layer beneath groups. Each focus is one reviewer assignment with a specific investigation question, checks, selected-item subset, evidence context, tier, and rationale. A focus belongs to one parent group, may select only that group's items, and may overlap other focuses inside that group. The focuses of a group must cover that group's items, so a group cannot claim cohesive scope that no reviewer receives. Use a separate sealed-input-derived `maxFocuses` policy rather than `maxGroups`: for non-empty input it is `clamp(maxGroups + 2, 3, profile.maxFocuses)`. Explicit profile/package ceilings are fast 14, balanced 26, thorough 34, and package 34; each profile is at least its `maxGroups + 2`. This preserves three independent focuses for a one-file change and two bounded overlap slots above the one-focus-per-group baseline.

Schedule reviewer and, when needed, verifier roles by focus through one global role-concurrency cap. Aggregate item completion only after all focuses containing that item complete. Deterministically merge only identity-certain same-cause candidates from overlapping focuses for the visible result: equal path, side, category, uniquely resolved changed range, normalized anchor text, and normalized causal text (`summary` plus `impact`). Preserve candidates as distinct whenever any identity component is uncertain, while retaining all individual candidate and validation provenance in the receipt. A visible merge takes its content and severity from the highest-severity non-rejected candidate, with stable candidate ID as the tie-break; rejected duplicates cannot affect visible output.

## Authority And Provenance

- User-ratified intent: semantically/structurally chunked, clean-context parallel review; dynamic diff-derived focuses; sustainable speed.
- Research: `.ledger/202608160933-adapt-review-planning-for-speed/research/pr-af-comparison.md`.
- Behavioral authority: `.ledger/202608160933-adapt-review-planning-for-speed/specs/adaptive-focus-review.md`.

## Alternatives Considered

### Keep one focus per non-overlapping group

This keeps the current schema small but cannot independently review authorization, migration, and concurrency concerns over one cohesive change. It contradicts the requested dynamic-focus behavior.

### Copy PR-AF's intake, anatomy, three meta-selectors, coverage loop, child agents, adversarial layer, and compound analysis

This offers a broader research pipeline but adds several model stages, duplicates local coverage/verification mechanisms, has no demonstrated local consumer for most added outputs, and conflicts with the fast-loop constraint.

### Replace groups with freely overlapping dimensions

This supports overlapping review units but would allow a group to name selected items that no child focus investigates. Coverage would become model-dependent unless every selected item still has at least one focus and every group's declared items remain covered by that group's focuses.

### Add an LLM duplicate resolver

It could detect broader semantic duplicates but adds latency and nondeterminism for a problem created by overlapping assignments. A source-anchor-based canonical merge is enough for this task.

## Consequences

- The planner's typed schema, role prompt, work-graph validation, receipt shape, controller scheduling, summaries, tests, and documentation change together.
- Reviews may use more than one reviewer on the same selected file, but every extra focus is explicit, capped, and separately accountable.
- Candidate-level and item-level completion become distinct internal concepts; the existing `completedItemIds` remains an aggregate output, not an optimistic per-reviewer mutation.
- The work is larger than a prompt tweak but remains one review-controller responsibility without a second runtime or phase graph.

## Limits And Revisit Conditions

Revisit if receipts show that focus planning routinely pads reviews, global scheduling harms latency, the conservative deterministic merge leaves costly duplicate noise or risks hiding distinct defects, or a measured benchmark establishes that an additional stage materially improves quality within the latency budget.

## Related Records

- `.ledger/202608160933-adapt-review-planning-for-speed/specs/adaptive-focus-review.md`
- `.ledger/202608160933-adapt-review-planning-for-speed/research/pr-af-comparison.md`

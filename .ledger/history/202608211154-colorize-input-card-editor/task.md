Status: done
Created: 2026-08-21
Updated: 2026-08-21

# Colorize the input card and custom editor

## Scope

Add vivid theme-aware semantic styling to the Apple Pi input card's model metadata, telemetry, and live extension statuses. Reuse Apple Pi component identity where the status key identifies an existing producer, while preserving native prompt-text styling, the current responsive composition, and native editor behavior.

## Non-goals

- Adding a user-configurable theme or hard-coded RGB palette.
- Changing status producer semantics, widget placement, editor input handling, or the card's geometry.
- Syntax highlighting arbitrary natural-language prompt content.
- Styling unrelated TUI components solely for visual consistency.

## Acceptance Criteria

- AC-001: Prompt text rendered by the custom editor retains Pi's native styling without corrupting cursor, autocomplete, wrapping, or ANSI-aware width behavior.
- AC-002: Model, provider, context, token/cache, cost, compaction, project, Git, session, and separator text use a varied semantic hierarchy based on Pi theme roles.
- AC-003: Known Apple Pi and MCP status producers are visually distinguishable by producer/state while each current status string remains present exactly once; unknown statuses remain readable.
- AC-004: Every rendered row still fits supported terminal widths, responsive omission priorities remain unchanged, and native editing behavior continues to delegate to Pi.

## Work Items

- [x] WI-001: Add focused rendering tests for native prompt preservation and semantic status/telemetry styling.
- [x] WI-002: Implement theme-aware input-card styling without changing state ownership.
- [x] WI-003: Update the input-card feature contract and run focused plus repository validation.

## References

- `docs/status-footer.md`
- `components/status-footer/src/ui/input-card.ts`
- `components/status-footer/tests/status-footer.test.ts`
- `.ledger/history/202608202232-redesign-input-area-information-layout/task.md`
- `components/subagents/src/agent-color.ts`
- `components/advisor/src/extension.ts`

## Assumptions

- User direction (2026-08-21): prefer abundant color, stylization, and visual integration with existing Apple Pi components.
- User correction (2026-08-21): the accent-colored prompt text looked terrible in the live TUI; preserve Pi's native prompt styling and increase color variety only in the surrounding card metadata and strip.
- Pi theme roles are the authoritative palette so custom themes and supported terminal color modes remain respected.
- Existing status keys, rather than parsing arbitrary status prose, are the stable integration boundary for producer identity.
- Prompt styling should emphasize the user's authored text as one readable surface; language syntax highlighting is outside the editor's contract.

## Journal

- 2026-08-21: Created the task and inspected the input-card renderer, native Pi editor render contract, current tests, prior accepted input-card design, and Apple Pi component styling patterns.
- 2026-08-21: Classified the change as bounded because the existing input-card renderer owns both requested surfaces; no new UI subsystem or interface is required.
- 2026-08-21: Operator approved the design and asked that prompt-text styling remain especially easy to reverse after visual evaluation. The first implementation isolated that treatment behind one helper and call site.
- 2026-08-21: Operator's live screenshot showed the bright accent prompt competing with the surrounding UI. Removed the isolated treatment completely, restored native prompt styling, and expanded the bottom strip through additional theme-owned syntax, Markdown, message, and thinking roles.

## Blockers

None.

## Evidence

- AC-001: Operator's second live TUI screenshot shows native prompt styling restored; `components/status-footer/tests/status-footer.test.ts` asserts the native prompt line remains unchanged.
- AC-002: Operator visually accepted the expanded theme-role palette as “way better”; focused tests assert distinct roles for model-adjacent and strip telemetry fields.
- AC-003: Focused tests assert known producer/state colors, unknown-status readability, nested producer ANSI restoration, and each visible status string exactly once.
- AC-004: Focused tests exercise ANSI-aware fitting across widths 1–240 and native input delegation. `npm test` passed 693 Vitest tests, 110/110 Advisor checks, and the package loader; `npm run typecheck`, `npm run pack:check`, scoped Biome lint/format, and `git diff --check` passed.
- TDD: RED runs observed failures before both the initial semantic styling and the user-directed native-prompt restoration/expanded palette; the final focused suite passed 20/20.
- Repository baseline limit: full `format:check` is blocked by pre-existing formatting in `components/memory/src/session-ledger/projection.ts` and `components/memory/tests/drain.test.ts`; full lint is blocked by pre-existing `useYield` in `components/memory/tests/drain.test.ts` (and reports a warning in `extensions/runtime-api.ts`). Those paths are unchanged in this task.

## Review

- Independent read-only review before the visual correction found no reachable ANSI, width, producer-state, or reversibility defect.
- The operator then rejected the prompt treatment on visual quality grounds; that treatment was removed rather than defended.
- The final live screenshot was visually accepted by the operator. No unresolved task-scoped review findings remain.

## Retrospective

The deliberately isolated prompt treatment made the visual correction cheap: one helper and one call site were removed without disturbing editor composition. The first palette also showed that broad semantic roles alone collapse into too few hues in real themes; using existing syntax, Markdown, message, and thinking roles creates variety while remaining theme-owned. Runtime strings must never be cast into theme-role types, so thinking-level selection now has an explicit safe map.

## Distillation

The user-facing color and native-editor contract is recorded in `docs/status-footer.md`; ANSI preservation, responsive fitting, producer-state styling, native prompt behavior, and unknown thinking-level fallback are executable in `components/status-footer/tests/status-footer.test.ts`. No additional ADR or reusable skill is warranted.

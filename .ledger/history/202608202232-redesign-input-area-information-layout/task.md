Status: done
Created: 2026-08-20
Updated: 2026-08-20

# Redesign the Pi input-area information layout

## Scope

Replace the rejected footer-only prototype with an Apple Pi-owned Zentui-style TUI input composition: a full-width native editor beneath neutral rules, restrained model/provider metadata, and a responsive compact Starship strip containing project/Git identity, context/cost/token telemetry, and live extension statuses. Preserve existing Advisor, MCP, subagent, Pi Exec, working-indicator, and RPC behavior outside this composition.

## Non-goals

- Copying, vendoring, or depending on Zentui or Powerline source.
- Adding Powerline's prompt queue, shell mode, welcome overlay, commands, persistent state, or editor-input interception.
- Adding OpenCode-specific metadata, message styling, or a broad theme/settings product.
- Changing Advisor, MCP, subagent, Pi Exec, or native working-indicator semantics merely to change their presentation.
- Replacing Pi's RPC-mode status/widget behavior.
- Retaining the footer-only diagnostic field-label layout.

## Acceptance Criteria

- AC-001: In TUI mode, the normal Pi editor is presented in a coherent Zentui-style composition with a full-width open prompt, neutral rules, unlabelled model/provider metadata, and compact Starship information strip rather than the rejected footer-only telemetry dump or a glyph box.
- AC-002: All currently visible live status producers remain represented once and without stale state: MCP including authentication progress, Advisor including reviewing/idle state and cost, and active subagent summary. Detailed agent, FleetView, and Pi Exec widgets retain their independent placements.
- AC-003: The card uses ANSI-aware measurement and deterministic responsive reflow/truncation so each rendered row fits at supported terminal widths and preserves the specified information priority without a row per telemetry field.
- AC-004: The custom-editor/footer lifecycle delegates normal Pi editing, autocomplete, paste, submission, and working-state behavior. It uses public APIs except for the explicitly authorized one-shot Pi 0.84.x telemetry bridge; a capture failure preserves the existing editor/footer, while a later card-construction failure restores Pi's built-in footer under documented last-footer-owner semantics.
- AC-005: In RPC/non-TUI mode, existing status and widget output remains usable and the card introduces no replacement editor or footer state.

## Work Items

- [x] WI-001: Map current input-area state producers and assess the official Pi, Zentui, and Powerline reference patterns.
- [x] WI-002: Specify the user-approved Zentui card hierarchy, responsive priorities, and native-editor behavior boundary.
- [x] WI-003: Replace the superseded footer-only plan with a source-backed card implementation plan, including editor/footer atomic installation and visual test seams.
- [x] WI-004: Implement and validate the approved card without importing unrelated reference behavior.

## References

- `research/ui-layout-references.md`
- `specs/zentui-input-card.md`
- `decisions/zentui-input-card-owner.md`
- `decisions/private-telemetry-bridge.md`
- `plans/zentui-input-card-implementation.md`
- `docs/development.md`
- `docs/boundaries.md`
- `components/advisor/src/extension.ts`
- `components/subagents/src/ui/agent-widget.ts`
- `components/subagents/src/ui/fleet-list.ts`
- `extensions/runtime-implementation.ts`

## Assumptions

- User direction (2026-08-20): Zentui's composed input card—not the footer-only prototype—is the required visual direction.
- User direction (2026-08-20): the two reference checkouts are temporary research material only, not repository content.
- User decision (2026-08-20): use private Pi internals to retain native `(sub)` and `(auto)` qualifiers; this is bounded by `decisions/private-telemetry-bridge.md`.
- No third-party source or dependency is authorized by this task; any later import requires its own provenance, license, and architecture decision.
- Current extension statuses and widgets are production information surfaces to preserve, not optional decoration.

## Journal

- 2026-08-20: Created task after mapping current Apple Pi footer/status/widget surfaces.
- 2026-08-20: Recorded temporary, revision-pinned assessment of Zentui and Powerline. Zentui's responsive status-preserving footer is the leading technical and visual reference; Powerline is presentation-only inspiration.
- 2026-08-20: User authorized the narrowly bounded private telemetry bridge after native subscription and auto-compaction qualifiers proved unavailable through the documented footer API.
- 2026-08-20: User rejected the initial footer-only prototype after comparing it with the Zentui card reference, and selected the composed input card. Superseded the prior spec, decision, and plan before treating any prototype code as accepted.
- 2026-08-20: Completed the source-backed card implementation plan, including the editor render seam, public/private telemetry boundary, responsive visual hierarchy, and focused validation matrix.
- 2026-08-20: Verified that Pi offers no custom-footer getter or transactional editor/footer replacement. Narrowed card installation to documented last-footer-owner semantics; custom-editor conflicts fail before replacement, bridge capture failure leaves UI untouched, and later construction failure restores only the built-in footer.
- 2026-08-20: Implemented the full-width, borderless input composition with neutral rules, native editor delegation, responsive status projection, native usage parity, and paired footer/editor cleanup.
- 2026-08-20: User visually accepted the live TUI after the final geometry and neutral-rule correction.

## Blockers

None.

## Evidence

- AC-001: User observed the final live TUI and confirmed that it looks great after the full-width geometry and neutral-rule correction.
- AC-002: `components/status-footer/tests/status-footer.test.ts` verifies ordered current MCP, Advisor, subagent, and unknown status text appears once while the implementation leaves detailed widgets untouched.
- AC-003: Focused rendering tests exercise widths from 1 through 240 cells, ANSI-aware fitting, responsive reflow, omission markers, and full-width geometry.
- AC-004: Bridge and installer tests verify one-shot restoration, native input delegation, paired lifecycle cleanup, editor conflicts, capture failure, and built-in-footer recovery.
- AC-005: The installer test verifies RPC mode performs no footer, editor, or private-bridge installation.
- Validation: `npm test` passed 685 unit tests, the 110/110 advisor harness, and the package loader; `npm run typecheck`, scoped Biome checks, and `git diff --check` passed.
- Limit: no third-party source was imported; the temporary Zentui and Powerline checkouts were removed after research.

## Review

- 2026-08-20: User visual review rejected the footer-only diagnostic field-label layout. Root cause: it did not implement the composed card hierarchy shown by the reference.
- 2026-08-20: User visual review rejected the capped, centred iteration and identified the thinking-level-tinted rules as visually intrusive.
- 2026-08-20: Final user visual review accepted the full-width composition with neutral subdued rules.
- 2026-08-20: Fresh visual review found no remaining code-level geometry or hierarchy mismatch; lifecycle review findings were resolved with paired footer/editor disposal.

## Retrospective

The showcase image was useful for hierarchy but not terminal geometry. Treating its centred rounded silhouette as a literal TUI layout produced the capped, squished regression. The successful design preserves terminal-native width, uses neutral structural rules, and confines model/thinking semantics to quiet metadata. Future visual work should separate promotional framing from runtime geometry before implementation.

## Distillation

Durable product behavior and compatibility boundaries were promoted to `docs/status-footer.md`; responsive, lifecycle, fallback, and status-preservation invariants live in production tests. No additional ADR or reusable skill is warranted because the task decisions remain specific to this input-card implementation.

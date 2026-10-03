Status: ready
Created: 2026-10-03
Updated: 2026-10-03

# Branch search: externally drawn parallel attempts scored by hidden checks

## Intent

Build branch search as specified in `spec.md`: hidden pre-registered scorer, externally drawn approaches, forked continuations in isolated worktrees that share the parent's cache prefix, objective selection, and apply. Acceptance criteria are spec section 2 (A1-A8).

## Current State

Spec section 15 records the verification answers: V1-V4 and V7 pass on Pi 0.99.0 with faux models (`evidence/branch-search-spike.test.ts`), V9 and V10 have no supported mechanism, and V11 is partly answered. V5, V6, and V8 are still open; the tickets that need them answer them.

Decided (operator, 2026-10-03):

- I2 by phase separation (spec 8.4 rewritten).
- Forks get no compaction or retry; a branch that ends on a provider error is scored as is (spec 6.6).
- Replay worlds after Dream-RSI: record nodes carry parent, start/end order, and cost; one pure `planStep` drives online and replay; later generations draw new roots too; replay tuning in spec 18.1. Draws became keyed by label (spec 6.5) so a node's draw does not depend on the configuration, which replay needs.
- No completion notification (V9) and no ledger summary (V10) in this version.

Planned deviations from the spec, within its stated latitude:

- Isolation through the fork's own `beforeToolCall` (argument remap, tool blocking) instead of global tool wrappers; bash cwd through a fork-context lookup in `components/tasks/src/bash-tool.ts`.
- Module layout under `components/branch-search/src/` with a thin `extensions/branch-search.ts`, per `AGENTS.md`.
- `docs/boundaries.md` has no "No Git Worktree Circus" section; amend the `pi-subagents` row instead.

Ticket 01 criterion 9 (2026-10-03): in this project's live Anthropic session (claude-opus-5-5), each change-review fork's first request read 118k to 188k tokens from cache (`forked_continuation` usage entries, input 2 to 4 tokens). That session ran the fork code from before ticket 01. `startFork` builds the request the same way, and the worktree binding changes only tool arguments, not request bytes. Still to confirm: one live fork that runs the new code (any change review after a reload).

Tickets: `tickets/01` to `tickets/09` (approved 2026-10-03). They replace the phase table in spec section 17. Each ticket can start when the tickets it depends on are done: 01 → 02 → 03 → 04 → {05, 06}; 02 → 07 → 08; {04, 07} → 09.

Ticket 01 (forks bound to their own worktree) is implemented and reviewed in the working tree, not yet committed. Its criterion 9 still needs one live fork on the new code. Next: commit ticket 01, then ticket 02.

## Outcome

Pending.

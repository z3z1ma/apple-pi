Status: in-progress
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

Progress:

- 01 committed (`ccd4f5f`). Criterion 9 still needs one live fork on the new code.
- 02 committed. Deviations: a missing or invalid configuration returns outcome `not configured`; the scorer schema check runs before git work and returns `aborted: scorer invalid`; generation 0 is capped at `branches.maxTotal`; the report adds `Merge:` and `Reason:` lines; the record adds `cleanupErrors`. The fork's working directory follows the session's subdirectory, and the repository root keeps the session's spelling of the path. Worktree forks refuse background bash. Scorer files are refused when a symlink leads them outside the worktree, and the branch dies.
- 03 committed. Deviations: a failed `git apply` restores the base and ends `ready` with the reason; a winner with the base tree counts as `applied` with nothing to change; a scorer whose files cannot be installed on the base is invalid; diffs ignore user diff drivers (`--no-ext-diff --no-textconv`), so the merge command text differs slightly from spec 6.9. Real-path resolution follows links component by component, like the kernel. Waiting for the root session to settle before apply (spec 6.9 step 1) moves to ticket 04.
- 04 committed. `/branch-search` is live: author loop, freeze, review, phase separation, report message. Deviations: review also runs on a supplied scorer, so evaluation with oracle gates must leave `scorer.reviewProfile` unset; a failed review keeps the author's scorer; apply holds the root session (root `write`/`edit`/`bash`/`pi_exec` are refused while it applies) and rollback restores only paths the apply still owns; each worktree fork gets a private temp directory under the state directory; a command goal appears in the enumerator and branch prompts. Residual risks (documented): a process that leaves its group, literal `/tmp` paths in shell commands, reuse of an emptied process-group number. - 07 committed. Later generations run all six planning rules; `draw: "model"` works. Children and dead-parent enumerators map their ancestors' worktree paths to their own worktree (`ForkWorktree.ancestors`). One failed enumerator stops its siblings and ends `aborted: enumeration failed`. Deviations: concurrent enumerators share a worktree-command queue; status adds `enumerate g<n>`; a parent is enumerated even when `maxTotal` leaves no room for its children (spec rule order).

## Outcome

Pending.

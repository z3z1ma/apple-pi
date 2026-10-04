# 02: Generation-0 search from a supplied scorer

**What to build:** The orchestrator runs a complete first generation for a scorer it is given. It loads and validates the configuration (spec 11), snapshots the base without touching the user's index (6.1), enumerates approaches in a role fork (6.4), draws roots with keyed seeded draws (6.5), and runs them at the same time in worktree forks under the root directive (10.3) within the branch limits (6.6). It parses each self-report, commits each branch, installs scorer files and restores protected paths (7.3), runs the gates (6.7 step 1), and picks the survivor with the smallest `diff_size`, then node key (7.4). The planning function (6.7) decides generation 0 and the stop. The search ends `ready` with the merge command or `no survivor`, returns the report body (6.10), writes the full record (12), and always cleans up (6.11). The supplied-scorer input stays after ticket 04: evaluation uses it for oracle gates. No user command yet; ticket 04 adds it.

**Blocked by:** 01 (Forks bound to their own worktree).

**Status:** ready-for-agent

- [ ] A missing required configuration key stops the search before any git or model work, and the returned text names each missing key.
- [ ] A workspace without a `HEAD` commit ends with `aborted: no git history`.
- [ ] The base commit captures uncommitted and untracked non-ignored files, and the user's git index is byte-identical before and after the search.
- [ ] The same seed and candidate list give the same roots and constraints (A5), and position `p` of a draw order is the same for any number of positions drawn.
- [ ] On the fixture repository with scripted model replies, a search with one passing and one failing root ends `ready`, names the passing root as winner, and the report's merge command applies its diff cleanly to the base.
- [ ] A search where every root fails a gate ends `no survivor`.
- [ ] A branch that edits a protected file is scored against the base content of that file, and scorer files never appear in a branch commit.
- [ ] A branch that exceeds its wall-clock or output-token limit is aborted, reports `limit`, and is still scored on its commit (I6).
- [ ] After success, after cancellation through the abort signal, and after an injected error, no worktree of the search remains and only the base and winner refs remain.
- [ ] The record holds every branch with parent, start order, end order, and cost, every planning step, and parent-tree checks that show the parent workspace unchanged across the generation.
- [ ] While the search runs, the editor status shows `branching <phase> <alive>/<total>`; it clears after cleanup.
- [ ] The boundaries documentation records the narrow worktree exception for branch search (spec 20).

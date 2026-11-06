## file

`compare_program` runs every task in both arms per round (the first arm alternating by round), each run in a fresh git worktree at one base revision with the candidate program present only in its arm, and each peer launched in that worktree with `--approve` so the project's programs load. The check runs only after a completed turn. A peer turn's own failure is that run's result; a worktree, program-open or program-close failure, or an abort, ends the comparison, after the worktree of that run is removed (`git worktree remove --force`, else delete the directory and `git worktree prune`).
Why: headless peers decline project trust without `--approve` (Pi's `defaultProjectTrust` is "ask" and RPC mode cannot ask), so a peer in an untrusted worktree never sees the program and both arms would measure the same thing. A failed close may leave a peer alive; starting another run beside it would mix its work into the next measurement. `specs/program-comparison.tla` checks that no worktree outlives its run and no run starts beside a live peer, and that the two earlier drafts (worktree added outside the cleanup block; a failed close recorded and skipped) each break one of those; `specs/program-comparison.lean` proves both arms of every task get exactly `samples` runs.

The operator agrees to each comparison through `ctx.ui.confirm`, with the run count and an estimate from the median cost of the last 50 completed review attempts; a session without UI refuses.
Why: the operator decided to be asked before each evaluation (2026-11-05). The estimate is rough by construction: reviewer turns are the only recorded peer turns with stored usage.

Coupled: components/session-state/src/runtime.ts, components/session-state/src/program-client.ts, components/programs/src/programs.ts, roles/capability-steward.md, specs/program-comparison.tla, specs/program-comparison.lean
Verify: components/session-state/tests/program-peers.test.ts, tests/lifecycle-models.test.ts

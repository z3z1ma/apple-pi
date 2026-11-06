# 04: Measure a candidate program with paired runs

**What to build:** Given a candidate saved program and a set of real recorded tasks, each with a correctness check written before the runs by someone other than the proposer, run every task with temporary peers in identical worktrees, with the program available and without it, at least three samples per arm, and report correctness first, then tool calls, tokens, cost and elapsed time, with every sample listed.

**Blocked by:** None (can start immediately)

**Status:** done

Built as the native tool `compare_program` (programs component), with a runtime change: a program may name the directory a peer starts in, and such a peer runs headless with `--approve` so the worktree's programs load. Models: `specs/program-comparison.tla` (cleanup and no run beside a live peer, with two controls) and `specs/program-comparison.lean` (balanced arms).

This is the riskiest ticket: model variance and spend decide whether the comparison means anything. The operator decided the steward asks him before each evaluation, with its estimated cost.

- [x] Both arms of a task start from the same commit and the same prompt; only the program's availability differs (the test's check passes only in the arm with the program).
- [x] The report lists every sample's tool calls and seconds, not only medians; it states counts per arm and leaves the judgment of spread to the reader rather than a fixed test.
- [x] Before running, the tool shows the run count and estimated cost and runs only if the operator agrees; without an interactive operator it refuses.
- [x] Every worktree is removed whatever fails, and no run starts beside a live peer: checked by TLC, and by the test's clean ownership after a three-sample comparison.

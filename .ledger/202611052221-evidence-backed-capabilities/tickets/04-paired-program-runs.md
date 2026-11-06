# 04: Measure a candidate program with paired runs

**What to build:** Given a candidate saved program and a set of real recorded tasks, each with a correctness check written before the runs by someone other than the proposer, run every task with temporary peers in identical worktrees, with the program available and without it, at least three samples per arm, and report correctness first, then tool calls, tokens, cost and elapsed time, with every sample listed.

**Blocked by:** None (can start immediately)

**Status:** planned

This is the riskiest ticket: model variance and spend decide whether the comparison means anything, and the spend limit is the operator's decision.

- [ ] Both arms of a task start from the same commit and the same prompt; only the program's availability differs.
- [ ] The report lists every sample, not only medians, and says when the arms do not differ beyond their spread.
- [ ] A run that exceeds the operator's spend limit stops and reports what it measured so far.
- [ ] Every worktree and temporary peer is cleaned up on success, failure and cancellation.

# 06: Passive trigger and in-branch stall abort

**What to build:** A failure repeated enough times in the root session starts one passive search with that command as the seed gate (spec 5.3). The same detector runs inside each branch with its own counts and aborts a branch that is stuck on one failure (6.6 step 4).

**Blocked by:** 04 (`/branch-search` with a hidden authored scorer).

**Status:** ready-for-agent

- [ ] Failure signatures replace absolute paths with basenames, digit runs with `#`, and hex runs of six or more characters with `#`; the same failure at a different line number gives one signature.
- [ ] A later exit 0 of the same normalized command clears all signatures of that command.
- [ ] With passive mode on, a signature that reaches the threshold starts one passive search at the next root settle, with that command as the seed gate, and the same signature never starts a second search in the session.
- [ ] With passive mode off, no repeat count starts a search.
- [ ] A branch that repeats one failure signature up to the threshold is aborted, reports `stalled`, and is still scored.
- [ ] Tool results produced inside forks do not count toward the root session's signatures.
- [ ] The docs page describes passive activation and its configuration keys.

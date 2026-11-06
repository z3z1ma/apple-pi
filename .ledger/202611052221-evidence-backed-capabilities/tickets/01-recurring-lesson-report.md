# 01: Report recurring lessons and failures across sessions

**What to build:** A read-only report of what keeps coming back across every session: notebook learnings, `LEARNINGS.md` lines, rule refusals, review findings and failed tool results, grouped by similarity, each group with its count and links to its occurrences. Counts start at the last commit that changed the surface the group concerns; a group with too few occurrences in that window is reported as too new to judge.

**Blocked by:** None (can start immediately)

**Status:** planned

- [ ] Run on this machine, the report lists the batching lesson as one group with links to its recorded occurrences.
- [ ] Each group names the surface it concerns and the commit its window starts from.
- [ ] The report reads only; it writes nothing and records no rule firings.
- [ ] It reads other sessions' learnings through the existing transcript index, not by parsing every JSONL on each run.

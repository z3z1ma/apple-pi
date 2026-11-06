# 01: Report recurring lessons and failures across sessions

**What to build:** A read-only report of what keeps coming back across every session: notebook learnings, `LEARNINGS.md` lines, rule refusals, review findings and failed tool results, grouped by similarity, each group with its count and links to its occurrences. Counts start at the last commit that changed the surface the group concerns; a group with too few occurrences in that window is reported as too new to judge.

**Blocked by:** None (can start immediately)

**Status:** done

Built as the native tool `session_evidence` (repo-rules component). It lists the evidence; grouping by similarity is the steward's judgment (ticket 03), not a token measure in code.

- [x] Run on this machine since 2026-11-01, it returns the batching lesson's occurrences with links: at least five notebook learnings and 17 "commit beside an edit" refusals, among 206 learnings, 22 refusals, 209 failed calls and 3 program calls in 15 sessions.
- [x] The window start is explicit and stated in the output; the steward picks the last change to the surface.
- [x] It reads only; it writes nothing and records no rule firings.
- [x] It streams the session logs (2 seconds for that window) instead of the transcript index, which turned out unnecessary at this cost.

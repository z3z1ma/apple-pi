# 07: Who knows what (`org_expertise`)

Part of the approved spec [../spec.md](../spec.md), as redirected by [../direction.md](../direction.md) and the operator's sign-off notes of 2026-10-26 (four specific inspection tools; expertise first; fitness frozen). Its Terms table defines window and the other words used here.

**What to build:** Any person can ask who has context on what, in both directions, with the read-only tool `org_expertise`, installed for every person. Given an area (a path or directory, relative to the caller's directory or absolute, or a word matched within paths), it lists the people who read or edited files there: for each, how many reads and edits, when they last touched it, which tasks they held while touching it (with their outcome when finished), and whether their context is still warm: working, idle, or at home, and whether their session was compacted since they last touched the area. Given a person, it lists the areas that person touched, grouped by directory, with the same counts and recency. A window narrows to touches inside it. A subtree scope narrows to people in that subtree. People are this organization's members, former members marked as such. Everything comes from what the runtime already records (the tool-call index with its paths, assignments, compactions, incarnations, and the directory); the tool stores nothing. It reports facts sorted by activity, with references (`person:`, `task:`, `file:`), and draws no conclusion about who is best; the caller narrows by area rather than the tool cutting results.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Against a temporary state database, asking about `components/session-state` lists the two people who edited files under it, with their read and edit counts, last touch, and the task each held at the time, and leaves out a person who only touched other paths.
- [ ] A word such as `fitness` matches touched paths containing it, and an absolute path and the same path relative to the caller's directory give the same answer.
- [ ] A person whose session was compacted after their last touch of the area is reported as compacted since; one at home is reported at home; a former member is marked as having left.
- [ ] Asking about a person lists the directories they touched with counts and last touch, and a window keeps only touches inside it.
- [ ] A subtree scope keeps only people in that subtree.
- [ ] Through a faux session, a person without manager tools calls `org_expertise` and gets the answer; the package-load smoke test lists `org_expertise`.

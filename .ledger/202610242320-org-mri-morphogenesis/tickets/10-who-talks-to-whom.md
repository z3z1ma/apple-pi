# 10: Who talks to whom (`org_communication`)

Part of the approved spec [../spec.md](../spec.md), as redirected by [../direction.md](../direction.md) and the operator's sign-off notes of 2026-10-26. Its Terms table defines window and the other words used here.

**What to build:** Any person can see the organization's communication over a window with the read-only tool `org_communication`, installed for every person. It lists, for pairs of people and for pairs of teams (by manager), how many messages went between them in mail, meetings, task threads, and channels; per person, the open decisions requested of them (`requires_decision` links to them) and the escalation threads where the last message is not theirs; and the threads with the most messages in the window. Scope: the organization, a person's subtree, or a person. Membership follows the fitness module's historical replay. It reports counts with references (`thread:`, `person:`, `link:`), never verdicts about whether communication is too much or too little.

**Blocked by:** 09 (Where work stands).

**Status:** done (37b8bb3b)

Operator-approved implementation refinement: explicit escalation kind rather than subject inference; participant-pair counting; join/leave facts in the existing event history, atomically paired with access changes. Migration28 seeds surviving known joins and discloses irrecoverable earlier departures. These essential observations supersede the original no-new-facts constraint. Review closed all new findings; ticket15 temporary-peer history remains limited. Final frozen-tree proof:94/94 focused plus world4/4, loader/typecheck/Biome/context lint. Operator approved43/43 hunks; live rollout not claimed.

- [x] Against a temporary state database, messages between two people across two threads in the window are counted for that pair and for their teams; messages outside the window are not.
- [x] A manager with two open decisions requested of it and one escalation whose last message is its report's shows both.
- [x] A person scope keeps that person's pairs, decisions, and escalations; a subtree scope keeps its members'.
- [x] Through a faux session a person calls `org_communication`; the package-load smoke test lists it.

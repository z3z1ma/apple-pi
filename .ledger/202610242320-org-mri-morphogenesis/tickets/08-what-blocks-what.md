# 08: What blocks what (`org_waits`)

Part of the approved spec [../spec.md](../spec.md), as redirected by [../direction.md](../direction.md) and the operator's sign-off notes of 2026-10-26. Its Terms table defines window and the other words used here.

**What to build:** Any person can see what is waiting on what with the read-only tool `org_waits`, installed for every person. It lists the open waits (`blocks` and `requires_decision` links) with waiter, target, relation, reason, and age, grouped by target so a target several tasks wait on shows with all of them, ordered by how many wait on it and then by age. It marks waits that cross teams (the waiter's manager differs from the target's). Given a window, it also lists the waits resolved in it (recently unblocked). Scope: the organization, a person's subtree, a person (waits it recorded or that target it or its tasks), or a task (waits from and to it). It reuses the links and the membership replay in the fitness module, adds no stored state, and reports facts with references (`link:`, `task:`, `person:`), never verdicts.

**Blocked by:** 07 (Who knows what), for the shared inspection module and its scope handling.

**Status:** ready-for-agent

- [ ] Against a temporary state database with two tasks waiting on one person's decision and one waiting on another task, the result groups the first two under that person, ordered first, each with its age and reason; a resolved wait is absent.
- [ ] A wait whose waiter and target report to different managers is marked as crossing teams.
- [ ] With a window, waits resolved inside it are listed as unblocked; those resolved outside it are not.
- [ ] Person, task, and subtree scopes keep only their waits.
- [ ] Through a faux session a person calls `org_waits`; the package-load smoke test lists it.

# 08: What blocks what (`org_waits`)

Part of the approved spec [../spec.md](../spec.md), as redirected by [../direction.md](../direction.md) and the operator's sign-off notes of 2026-10-26. Its Terms table defines window and the other words used here.

**What to build:** Any person can see what is waiting on what with the read-only tool `org_waits`, installed for every person. It lists the open waits (`blocks` and `requires_decision` links) with waiter, target, relation, reason, and age, grouped by target so a target several tasks wait on shows with all of them, ordered by how many wait on it and then by age. It marks a wait as crossing teams when it has at least one target owner and no waiter shares a team with any target owner. People share a team when one directly manages the other or they share a non-null manager; task parties are their holders at the judged time, with the recorder as waiter when no source person or holder supplies one. Open waits use the snapshot cutoff; resolved waits use their resolution time. Given a window, it also lists the waits resolved in it (recently unblocked). Scope: the organization, a person's subtree, a person (waits it recorded or that target it or its tasks), or a task (waits from and to it). It reuses the links and the membership replay in the fitness module, adds no stored state, and reports facts with references (`link:`, `task:`, `person:`), never verdicts.

**Blocked by:** 07 (Who knows what), for the shared inspection module and its scope handling.

**Status:** done (4f93312c; stale ticket status reconciled at final closure)

- [x] Against a temporary state database with two tasks waiting on one person's decision and one waiting on another task, the result groups the first two under that person, ordered first, each with its age and reason; a resolved wait is absent.
- [x] A wait whose waiter and target report to different managers, with neither directly managing the other, is marked as crossing teams.
- [x] With a window, waits resolved inside it are listed as unblocked; those resolved outside it are not.
- [x] Person, task, and subtree scopes keep only their waits.
- [x] Through a faux session a person calls `org_waits`; the package-load smoke test lists it.

Closure: existing implementation/review was already complete; this corrects bookkeeping, not code. Current final chair checks include inspect/work suites and loader; all passed. Historical membership/eligibility refinements remain qualified in later closure records.

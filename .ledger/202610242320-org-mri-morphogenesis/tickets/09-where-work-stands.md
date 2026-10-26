# 09: Where work stands (`org_work`)

Part of the approved spec [../spec.md](../spec.md), as redirected by [../direction.md](../direction.md) and the operator's sign-off notes of 2026-10-26. Its Terms table defines obligation, completion, window, and the other words used here.

**What to build:** Any person can see where work stands with the read-only tool `org_work`, installed for every person. It lists the organization's open tasks under exactly one state each, with age since they opened and who holds them: ready without an owner (no open assignment, no open wait), waiting (an open wait), and in progress (held, no open wait). It lists people holding more than one task. Given a window, it adds tasks opened and closed in it (`done`, `cancelled`), so arrivals can be compared with completions. Scope: the organization, a person's subtree, a person, or a task. It reuses the task records, assignments, and links, adds no stored state, and reports facts with references (`task:`, `person:`), never verdicts.

**Blocked by:** 08 (What blocks what).

**Status:** done (248c300d; stale ticket status reconciled at final closure)

- [x] Against a temporary state database with two ready tasks nobody holds, a waiting task, two in-progress tasks, and one person holding three tasks, every open task appears under exactly one state with its age and holders, and the person holding three is listed.
- [x] With a window, tasks opened and closed inside it are counted by status; those outside are not.
- [x] After a ready task is assigned, the next call shows it in progress, not ready.
- [x] Person, task, and subtree scopes keep only their work.
- [x] Through a faux session a person calls `org_work`; the package-load smoke test lists it.

Closure: existing implementation/review was already complete; this corrects bookkeeping, not code. Current final chair checks include org-work/work suites and loader; all passed. The final scripted manager demonstration also verifies the native ready-to-held transition, and the refreshed root's live org_work call succeeded.

## file

Directory work and availability come from assignments, not run state or file touches. The record contains finished assignments, including exact outcomes; unassignments remain in the database but are not accomplishments. Goal text stays in task.md; missing or unreadable goals are marked explicitly.
Coupled: components/organization/src/directory.ts, components/session-state/src/peers.ts, components/session-state/src/work.ts
Verify: components/session-state/tests/work.test.ts

## symbol:backlogOf

Discovery is read-only. An unregistered backlog entry uses its absolute bundle path as its handle, because a manager can see a colleague's ledger outside its own cwd. Registered tasks keep their runtime ids, and tasks assigned anywhere or registered to another organization are excluded.
Why: returning only a ledger folder's basename makes take_task resolve it in the caller's wrong repository; registering tasks while listing would make a view another writer of work state.
Coupled: components/shared/src/ledger-files.ts, components/session-state/src/work.ts
Verify: components/session-state/tests/work.test.ts

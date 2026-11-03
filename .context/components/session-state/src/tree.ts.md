## file

`rootOf` follows recorded managers up and stops at a missing manager. A task's organization is the current root of the organization that recorded it. A merge brings that root's work along. `organizationsOf` is the named organization plus every root that has joined it.
Why: a merge must not leave the joined root's tasks behind, and a missing manager must not hide the person from every directory.
Coupled: components/session-state/src/work.ts, components/organization/src/directory.ts
Verify: components/session-state/tests/organization.test.ts

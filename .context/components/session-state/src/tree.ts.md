## file

`rootOf` follows recorded managers up and stops when the next manager is missing. A cycle throws. `taskOrganization` is the current root of the organization recorded on the task. `anchorsOf` is that organization plus every recorded task anchor whose current root is it.
Why: a merge must not leave the joined root's tasks behind, and a missing manager must not hide the person from every directory.
Coupled: components/session-state/src/work.ts, components/organization/src/directory.ts
Verify: components/session-state/tests/organization.test.ts

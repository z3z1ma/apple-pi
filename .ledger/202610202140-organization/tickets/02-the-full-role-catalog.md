# 02: The full role catalog

**What to build:** Every role in the spec's catalog exists as a package role file with its minds, thinking level, posture, and a body written to the bar of the seed profiles: the obligation that sets the role apart, what it leaves to others, its operating principles, and the artifact it owes, in plain language, a few hundred words. Obligations collide on purpose across the catalog. A managing role's prompt lists the catalog's titles with one-line mandates so it can hire from it.

**Blocked by:** 01 A session started with a role is that role

**Status:** ready-for-agent

- [ ] Each of the 31 catalog roles loads with the minds and thinking level in the spec, and the two managing roles are the only ones with `manages: true`.
- [ ] A test loads every package role and fails on a missing field, an unknown model id format, or an empty body.
- [ ] A session with the coordinator role has every catalog title and its one-line mandate in its prompt; a non-managing role does not.
- [ ] Hiring each of three roles with the same brief (the Distinguished Engineer, the Simplicity Engineer, and the Architecture Prosecutor) through a faux model shows three prompts whose obligations differ, not one prompt with three titles.

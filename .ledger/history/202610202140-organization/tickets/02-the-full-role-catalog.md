# 02: The full role catalog

**What to build:** Every role in the spec's catalog exists as a package role file with its minds, thinking level, posture, and a body written to the bar of the seed profiles: the obligation that sets the role apart, what it leaves to others, its operating principles, and the artifact it owes, in plain language, a few hundred words. Obligations collide on purpose across the catalog. A managing role's prompt lists the catalog's titles with one-line mandates so it can hire from it.

**Blocked by:** 01 A session started with a role is that role

**Status:** done

- [x] Each of the 31 catalog roles loads with the minds and thinking level in the spec, and the two managing roles are the only ones with `manages: true`.
- [x] A test loads every package role and fails on a missing field, an unknown model id format, or an empty body.
- [x] A session with the coordinator role has every catalog title and its one-line mandate in its prompt; a non-managing role does not.
- [x] Hiring each of three roles with the same brief (the Distinguished Engineer, the Simplicity Engineer, and the Architecture Prosecutor) through a faux model shows three prompts whose obligations differ, not one prompt with three titles.

Deviations: role files carry a `mandate` line in front matter, so the catalog section (`<role-catalog>`, shown to whoever holds the manager tools, not only managing roles, since the operator's root session hires too) reads it instead of a hand-kept list. The coordinator keeps its short body; managers get their deliverable from the `<manager>` charter.

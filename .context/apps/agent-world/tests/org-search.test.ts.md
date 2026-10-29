## file

These tests exercise the production metadata projection used by OrgSearch. The fixture distinguishes awake people, people at home, temporary/former identities and a moved person's task anchored to their previous organization. Assertions cover which identified rows the user can find and their displayed scope, not the search algorithm.
Why: a result under someone's current team must not relabel their past work as belonging to that team. Checking only task titles would miss this ownership error.

Explicit preference-map cases prove custom labels and original person/head-name aliases are searchable, changing the map changes result labels, and current-team naming cannot transfer historical task ownership. Recorded-team route metadata is present only for the same visible current root, not a missing, nested, temporary or former anchor. These are pure projection checks; immediate subscription updates and the actual onTeam callback still need browser proof.

The missing-history explanation, explicit readTask calls, no-seen behavior and keyboard interactions belong to browser tests; an empty helper array cannot prove an honest unavailable-history message.
Coupled: apps/agent-world/web/workplace-org-search-model.ts, apps/agent-world/web/workplace-org-search.tsx
Verify: apps/agent-world/tests/world-org.test.ts

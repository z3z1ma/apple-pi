## file

These tests exercise the production metadata projection used by OrgSearch. The fixture distinguishes awake people, people at home, temporary/former identities and a moved person's task anchored to their previous organization. Assertions cover which identified rows the user can find and their displayed scope, not the search algorithm.
Why: a result under someone's current team must not relabel their past work as belonging to that team. Checking only task titles would miss this ownership error.

The missing-history explanation, explicit readTask calls, no-seen behavior and keyboard interactions belong to browser tests; an empty helper array cannot prove an honest unavailable-history message.
Coupled: apps/agent-world/web/workplace-org-search-model.ts, apps/agent-world/web/workplace-org-search.tsx
Verify: apps/agent-world/tests/world-org.test.ts

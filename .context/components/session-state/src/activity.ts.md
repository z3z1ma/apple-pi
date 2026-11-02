## file

An item is a fact a source reported; its id is `<source>:<source key>`, so reading the same event again never adds or changes it, and the desk's decision (`triage`) survives later reads. `delivered_at` records that the item went to the coordinator for triage, separately from the decision. Sources are off until the operator chooses a mode (`activity-triage` preference): no runtime, including a test's, reads Slack, GitHub or Jira unless that preference turns a source on.
Why: the operator's own settings already filter GitHub and Slack; reading them for every isolated test runtime would call real accounts.
Rules apply once, when an item arrives, and the item keeps the rule's id; a later rule does not re-decide earlier items, and a removed rule's items read as undecided again. `placeOf` is mirrored in `apps/agent-workplace/web/workplace-outside.tsx`, which builds rules from an item; the two must name places the same way.
Coupled: components/session-state/src/activity-poller.ts, components/session-state/src/activity-tools.ts, apps/agent-workplace/src/backend/workplace.ts, apps/agent-workplace/web/workplace-outside.tsx
Verify: components/session-state/tests/outside-activity.test.ts

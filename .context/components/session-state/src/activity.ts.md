## file

An item is a fact a source reported; its id is `<source>:<source key>`, so reading the same event again never adds or changes it, and the desk's decision (`triage`) survives later reads. `delivered_at` records that the item went to the coordinator for triage, separately from the decision. Sources are off until the operator chooses a mode (`activity-triage` preference): no runtime, including a test's, reads Slack, GitHub or Jira unless that preference turns a source on.
Why: the operator's own settings already filter GitHub and Slack; reading them for every isolated test runtime would call real accounts.
Coupled: components/session-state/src/activity-poller.ts, components/session-state/src/activity-tools.ts, apps/agent-workplace/src/backend/workplace.ts
Verify: components/session-state/tests/activity.test.ts

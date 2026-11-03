## file

Managers and the scout may read outside activity, notes and canvases. `triage` and `activity_rule` stay with `managesPeople`; the scout's tool set omits them.
Why: reading and deciding are different authority. A scout that could triage would act as the desk.
Coupled: components/session-state/src/activity.ts, components/session-state/src/activity-sources.ts
Verify: components/session-state/tests/outside-activity.test.ts

## file

Only a confirmed successful outside write spends the review draft and refreshes the review/list.
Why: declining or failing a GitHub write must preserve the operator's text rather than pretend the review was submitted.
Coupled: apps/agent-workplace/web/overlay/places/forge-state.ts, apps/agent-workplace/web/overlay/places/outside-write.tsx
Verify: apps/agent-workplace/tests/world-forge.test.ts

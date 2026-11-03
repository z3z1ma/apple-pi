## file

Opening Places may fetch the cheap Jira/recent-page counts, while Forge counts wait for its normal PR listing.
Why: the Forge listing performs per-PR gh reads; opening or switching a navigation tab should not repeatedly trigger that expensive listing.
Coupled: apps/agent-workplace/web/overlay/places/forge-state.ts, apps/agent-workplace/web/overlay/places/atlassian-state.ts
Verify: apps/agent-workplace/tests/world-interface.test.ts

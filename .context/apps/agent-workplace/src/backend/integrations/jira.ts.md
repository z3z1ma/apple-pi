## file

Jira reads use REST API v3. Search is `POST /rest/api/3/search/jql`; the old `/search` is deprecated. A key lookup finds that issue even when text search would not. Comments and transitions are the only writes, and only the outside-write gate calls them.
Why: the quest office observes issues. A write that skipped the operator confirmation would change Jira without the gate's record.
The session-state runtime imports `adfText` from this file by path and loads it with Node type stripping. Keep the file free of Electron and of syntax Node cannot strip.
Why: a runtime import of Electron, or an enum or parameter property, fails the daemon at startup rather than only the Workplace build.
Coupled: components/session-state/src/activity-sources.ts, components/session-state/src/external-threads.ts, apps/agent-workplace/src/backend/integrations/gate.ts, apps/agent-workplace/src/backend/integrations/atlassian.ts
Verify: apps/agent-workplace/tests/integrations/atlassian.test.ts

## file

Jira reads use REST API v3. Search is `POST /rest/api/3/search/jql`; the old `/search` is deprecated. A key lookup finds that issue even when text search would not. Comments and transitions are the only writes, and only the outside-write gate calls them.
Why: the quest office observes issues. A write that skipped the operator confirmation would change Jira without the gate's record.
Coupled: apps/agent-workplace/src/backend/integrations/gate.ts, apps/agent-workplace/src/backend/integrations/atlassian.ts
Verify: apps/agent-workplace/tests/integrations/atlassian.test.ts

## file

Confluence here is read-only. Search uses v1 CQL because v2 has no equivalent. A page body comes from v2 `body-format=view`. Recently opened pages stay in a private file beside the credentials. Agent Workplace never writes to Confluence.
Why: the library is an observation surface. A write path would need the operator confirmation used by other outside mutations.
Coupled: apps/agent-workplace/src/backend/integrations/atlassian.ts, apps/agent-workplace/src/backend/integrations/credentials.ts
Verify: apps/agent-workplace/tests/integrations/atlassian.test.ts

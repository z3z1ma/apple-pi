## file

This is a plain Node module with no Electron import. Main wires it to IPC; tests call it with fakes. A sign-in is stored only after the site accepts it, so a typo never sits in the credentials file. Tests may replace the Slack Web API address; production uses the workspace's own.
Why: storing a rejected sign-in would make later requests fail with a credential the operator thinks is valid. This file is a plain Node module imported by tests and by Electron IPC; it must not import Electron. The runtime does not import this file. It imports `atlassian.ts`, `credentials.ts`, and `jira.ts` by path instead.
Coupled: apps/agent-workplace/src/electron/integrations-ipc.ts, apps/agent-workplace/src/backend/integrations/credentials.ts
Verify: apps/agent-workplace/tests/integrations/atlassian.test.ts, apps/agent-workplace/tests/integrations/slack.test.ts

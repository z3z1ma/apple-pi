## file

The Atlassian and Slack secrets live only in `agent-world-credentials.json` in the session-state directory, written whole through a 0600 temporary file and a rename (`writePrivate`); a file found wider is narrowed before it is read. `status` is the only view the renderer gets: site, email, and workspace name, never a token or cookie. Nothing here or in the adapters logs.
Why: decision 07 and ticket 24 ("never in the renderer, logs, or themes"); the test checks every answer the renderer can get and every console call for the secrets.
Coupled: apps/agent-world/src/integrations.ts
Verify: apps/agent-world/tests/integrations/atlassian.test.ts, apps/agent-world/tests/integrations/slack.test.ts

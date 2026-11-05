## file

The Atlassian and Slack secrets live only in `agent-workplace-credentials.json` in the session-state directory, written whole through a 0600 temporary file and a rename (`writePrivate`); a file found wider is narrowed before it is read. `status` is the only view the renderer gets: site, email, and workspace name, never a token or cookie. Nothing here or in the adapters logs.
Why: decision 07 and ticket 24 ("never in the renderer, logs, or themes"); the test checks every answer the renderer can get and every console call for the secrets.
The session-state runtime imports this file by path for outside-thread polling. Keep it free of Electron and of syntax Node cannot strip.
Why: the daemon loads these helpers directly. An Electron import here would stop the runtime, not only Workplace.
`sendAsMe` on the Slack session is the operator's choice to send agents' Slack messages through this session (`slack-sending.ts`, read at each send). It defaults off, survives a new sign-in and goes with sign-out.
Why: the operator asked for an explicit opt-in; an expired session he signs in again should not silently turn it off.

Coupled: apps/agent-workplace/src/slack-sending.ts, components/session-state/src/activity-sources.ts, components/session-state/src/activity-poller.ts, components/session-state/src/external-threads.ts, apps/agent-workplace/src/integrations.ts
Verify: apps/agent-workplace/tests/integrations/atlassian.test.ts, apps/agent-workplace/tests/integrations/slack.test.ts

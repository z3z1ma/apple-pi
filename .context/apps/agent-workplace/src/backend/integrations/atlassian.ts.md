## symbol:atlassianSite

The operator may type a site name, a host, or a full address. Plain http is allowed only on loopback, for the tests' fake servers.
Why: a non-loopback http origin would send the API token off TLS.
The session-state runtime imports `atlassianRequest` from this file by path. Keep it free of Electron and of syntax Node cannot strip.
Why: the daemon loads this module directly. An Electron import or non-erasable syntax fails runtime startup, not only the Workplace build.
Coupled: components/session-state/src/activity-sources.ts, components/session-state/src/external-threads.ts, apps/agent-workplace/src/backend/integrations/credentials.ts
Verify: apps/agent-workplace/tests/integrations/atlassian.test.ts

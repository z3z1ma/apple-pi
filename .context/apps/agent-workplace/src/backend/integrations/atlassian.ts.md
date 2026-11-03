## symbol:atlassianSite

The operator may type a site name, a host, or a full address. Plain http is allowed only on loopback, for the tests' fake servers.
Why: a non-loopback http origin would send the API token off TLS.
Coupled: apps/agent-workplace/src/backend/integrations/credentials.ts
Verify: apps/agent-workplace/tests/integrations/atlassian.test.ts

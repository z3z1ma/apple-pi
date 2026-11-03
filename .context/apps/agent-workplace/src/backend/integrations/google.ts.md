## symbol:googleStatus

Return only the account. `gws auth status` also prints private local credential diagnostics, and those must not cross into the renderer.
Why: Settings may know whether Google is signed in, never the credential material used to check it.
Coupled: apps/agent-workplace/src/integrations.ts
Verify: apps/agent-workplace/tests/integrations/issues.test.ts

## file

This suite loads the built Workplace in headless Chrome and enters the Git app through the bare landing route and the real rail button. The Git API is an in-memory fixture: overview, log pages, commit detail and a fixed diff, with every `run` call recorded. It proves which typed actions the renderer sends and what it shows; git-backend.test.ts proves what those actions do to a repository. The fixture's force-delete case returns Git's refusal for a normal branch delete so the second confirmation path is exercised.

The rail-overflow case uses a 560px-high window, opens Git through More, then grows the window and checks Git returns to the rail still selected.

Run against a fresh `npm run build:workplace`, with one worker. AGENT_WORLD_SHOTS saves light and dark screenshots; look at them, since layout and colour are not asserted.
Coupled: apps/agent-workplace/web/workplace-git.tsx, apps/agent-workplace/web/workplace-git-diff.tsx, apps/agent-workplace/web/workplace-git-graph.ts, apps/agent-workplace/web/workplace.tsx, apps/agent-workplace/src/git.ts
Verify: apps/agent-workplace/tests/world-git.test.ts

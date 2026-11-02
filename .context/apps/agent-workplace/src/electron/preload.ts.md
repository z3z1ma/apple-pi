## file

Optional lifecycle arguments must reach the main-process handler with explicit false intact; retire defaults an omitted handoff choice to true. Renderer fixtures supply `window.agentWorkplace` directly, so passing UI and backend tests do not establish that this forwarding boundary preserved the choice.
Why: dropping a new argument or treating false as omission can request a paid handoff the operator explicitly skipped while both endpoint suites stay green. Main and preload ship as committed build artifacts and must be rebuilt together.
Coupled: apps/agent-workplace/src/electron/main.ts, apps/agent-workplace/src/backend/lifecycle.ts, apps/agent-workplace/src/world.ts
Verify: apps/agent-workplace/tests/build.test.ts

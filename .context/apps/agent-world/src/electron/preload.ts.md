## file

Optional lifecycle arguments must reach the main-process handler with explicit false intact; retire defaults an omitted handoff choice to true. Renderer fixtures supply `window.agentWorld` directly, so passing UI and backend tests do not establish that this forwarding boundary preserved the choice.
Why: dropping a new argument or treating false as omission can request a paid handoff the operator explicitly skipped while both endpoint suites stay green. Main and preload ship as committed build artifacts and must be rebuilt together.
Coupled: apps/agent-world/src/electron/main.ts, apps/agent-world/src/backend/lifecycle.ts, apps/agent-world/src/world.ts
Verify: apps/agent-world/tests/build.test.ts

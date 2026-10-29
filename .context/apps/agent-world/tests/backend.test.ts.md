## file

The permanent-departure case waits for the public world snapshot to remove the person from both awake and dormant rosters and reduce the team's headcount before stopping the stand-in bridge. The lifecycle receipt is acceptance, not completion. Use the snapshot for the outcome rather than requiring a particular runtime event name.
Why: stopping the fixture first can conflate permanent departure with ordinary process shutdown. The user-visible contract is removal from the retained roster after a successful departure; an at-home person remains a different state. Database reads elsewhere in the harness synchronize fixture setup and teardown, rather than define this outcome.
Coupled: apps/agent-world/src/backend/lifecycle.ts, apps/agent-world/src/backend/world-backend.ts, components/session-state/src/runtime.ts
Verify: apps/agent-world/tests/backend.test.ts

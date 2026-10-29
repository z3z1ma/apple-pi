## symbol:SharedThread

A shared-thread read can advance the operator's cursor when the operator participates. The retained World tab therefore gates the read effect on host visibility as well as its thread/revision inputs. Hiding cancels local response handling, not a backend read already requested while visible. Restoring visibility rereads the displayed conversation; merely receiving a newer `latest` value still shows the explicit Read latest affordance rather than continuously fetching.
Why: CSS-hidden iframes remain mounted and can report a visible document. Treating the retained panel as continuously visible would let a reader mounted by an asynchronous panel update acknowledge content while the World tab is hidden.
Coupled: apps/agent-world/web/world-visibility.ts, apps/agent-world/web/workplace-world.tsx, apps/agent-world/src/backend/workplace.ts
Verify: apps/agent-world/tests/world-workplace.test.ts

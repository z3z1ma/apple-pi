## file

Retire is offered only for a character whose facts carry a role `title`, in both the world's right-click menu (`place-scene.ts`) and the side-panel row (`rows.tsx`); the operator's own sessions, which have no role, never see it. The form's words come from the theme's `retire*` lines (leave the guild, resign, graduate).
Why: retiring records that a person left the organization, and a session with no role is not a hired person; a retire sent for it would still succeed at the runtime and mark the operator's own session a former member. `world-movement.test.ts` pins the menu's item count for a character without facts, so an unconditional item breaks it.
Coupled: apps/agent-world/web/game/place-scene.ts, apps/agent-world/web/overlay/interface/rows.tsx, apps/agent-world/src/backend/lifecycle.ts, apps/agent-world/src/theme-pack.ts
Verify: apps/agent-world/tests/world-rename.test.ts, apps/agent-world/tests/world-interface.test.ts

## symbol:workplacePanels.carry

Carrying a goal is local to this window and changes no ownership. Only `give` calls `assignTask`; the runtime then records the assignment, focuses it, notifies the person, and wakes a sleeper. A failed give keeps the goal in hand so the operator can try someone else.
Why: a carried goal is a pointer gesture, and assigning on pick-up would hand work to nobody.
Coupled: apps/agent-world/web/game/place-scene.ts, apps/agent-world/src/backend/workplace.ts
Verify: apps/agent-world/tests/world-workplace.test.ts, apps/agent-world/tests/workplace.test.ts

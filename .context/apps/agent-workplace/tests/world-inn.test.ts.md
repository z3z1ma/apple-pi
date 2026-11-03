## file

Stopped sessions fill the inn's spots, most recently stopped first. A former member is marked retired and is not a wake target. Waking walks the person out by the door; the next sleeper from upstairs takes the free spot. A failed wake says why. An ended session comes in by the door and sits down; the oldest shown sleeper goes upstairs to make room. An asleep person has no terminal; the panel offers to wake them. `AGENT_WORLD_SHOTS` saves `aw-15-*.png`.
Why: waking a former member, or leaving the oldest sleeper in a full inn, would show the wrong person as available.

The retained former fixture is read-only; ordinary dormant people supply the successful/failed wake controls. After a successful wake removes one dormant fixture, the later failure case must target a different remaining dormant person.
Why: retaining a legacy former row is not authority to reopen it, while selecting an already-awake person merely times out before exercising the intended failure presentation. Menu/register/conversation assertions preserve reading alongside the restricted wake behavior.
Coupled: apps/agent-workplace/web/overlay/places/innkeeper.tsx, apps/agent-workplace/web/game/place-scene.ts, apps/agent-workplace/web/overlay/conversation/conversation-panel.tsx
Verify: apps/agent-workplace/tests/rename.test.ts

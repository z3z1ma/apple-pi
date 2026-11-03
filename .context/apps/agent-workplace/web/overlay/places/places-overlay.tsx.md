## file

The busy-session confirmation defaults focus to keeping the session alive, contains keyboard navigation while letting key releases reach Phaser, and restores its connected trigger or World focus when dismissed.
Why: a destructive confirmation must not leak world shortcuts or leave focus on a removed control.
Coupled: apps/agent-workplace/web/overlay/focus.ts, apps/agent-workplace/web/overlay/places/place-panels.ts
Verify: apps/agent-workplace/tests/world-interface.test.ts

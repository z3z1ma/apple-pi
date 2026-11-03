## file

Publish the minimap through the scene's read-only view methods, also used by headless tests, rather than mutable Phaser internals.
Why: interface state is a projection of the scene; mutating game state through the interface publisher would cross its ownership boundary.
Coupled: apps/agent-workplace/web/game/place-scene.ts, apps/agent-workplace/web/view-state.ts
Verify: apps/agent-workplace/tests/world-interface.test.ts

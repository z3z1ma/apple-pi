## file

Validate a replacement theme before fading/stopping the active scene. Preserve the working world on validation failure and remember failed theme IDs so repeated snapshots do not retry them. Switches are serialized with the latest queued ID; a caller queued behind an active switch returns false immediately. Settings persists a preference only when its switch returns true. Character/panel state lives outside the replaced scenes.
Why: overlapping or failed theme changes must not discard the working world or record an unvalidated preference; queued admission is not successful wear.
Coupled: apps/agent-workplace/web/theme.ts, apps/agent-workplace/web/theme-store.ts, apps/agent-workplace/web/game/boot-scene.ts
Verify: apps/agent-workplace/tests/world-themes.test.ts

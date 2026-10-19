## file

Delegation receipts go out on `world:receipt`, the conversation panel's own channel, with the target character's id; outside writes go out on `places:outside-write`, not `world:feed`, since feed lines are ordered and de-duplicated by the runtime's event `seq` (`web/world-store.ts`) and an outside write has none.
Coupled: apps/agent-world/src/electron/preload.ts, apps/agent-world/web/world-store.ts

The Slack sign-in window uses its own `persist:agent-world-slack` partition, no preload, and Electron's user agent without its `Electron/` token.
Why: the world window's session must never hold Slack cookies, and Slack refuses browsers it does not recognise. Checked by hand (ticket 27).
Coupled: apps/agent-world/src/backend/integrations/slack-sign-in.ts

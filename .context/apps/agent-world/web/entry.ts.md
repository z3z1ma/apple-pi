## file

Bare index.html opens Workplace Chat. Only the exact ?world query selects World; existing ?workplace=chat/mail/org/code/issues bookmarks still enter Workplace. Choose the workplace or World with dynamic imports before either application starts. Keep the workplace stylesheet inside its lazy entry rather than the shared HTML.
Why: each entry creates a store and React root on the same overlay; loading both would mount competing consumers, and the workplace stylesheet hides the game's canvas. Returning to World intentionally reloads the page so the other entry starts with fresh subscriptions.
Navigation checks follow the rendered links: Workplace opens Chat from World, and World selects ?world from Workplace. Workplace sets `document.title` and adds `body.workplace` only after its import; World keeps the HTML title.
Why: the stylesheet hides `#game` only under `body.workplace`. A renamed class on one side and not the other leaves the canvas visible under the overlay. A check that still clicks the old link name passes only against an unrebuilt bundle.
Coupled: apps/agent-world/web/index.html, apps/agent-world/web/main.tsx, apps/agent-world/web/workplace.tsx, apps/agent-world/web/workplace.css
Verify: apps/agent-world/scripts/workplace-smoke.mjs, apps/agent-world/scripts/workplace-electron-check.mjs, apps/agent-world/tests/world-conversation.test.ts, apps/agent-world/tests/world-interface.test.ts

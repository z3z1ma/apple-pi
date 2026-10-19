## file

Fidgets are presentation only (ticket 29, decision 27): nothing here may call `window.agentWorld`, send an intent that reaches the backend, or store anything in the runtime. A light's or box's on/open state lives in a module-level map keyed `theme:placeKey:slot index`, so it lasts while the app runs and resets on restart. `fidgets.test.ts` drives every play through the real backend API and fails on any command, runtime row, integration call, or outside request.
Verify: apps/agent-world/tests/fidgets.test.ts, apps/agent-world/tests/world-fidgets.test.ts

`views()` (`window.agentWorldView.fidgets()`) is what the headless tests read to tell a play happened (`art`, `on`, `playing`, `angle`, `speed`, `particles`, `glow`, `line`); renaming a field breaks them without a type error.
Coupled: apps/agent-world/web/main.tsx
Verify: apps/agent-world/tests/world-fidgets.test.ts

## symbol:Fidgets.stop

Runs on scene shutdown, after Phaser has already destroyed the images: it only removes timers and tweens.
Why: settling a fidget there (setting its texture back) threw `Cannot read properties of undefined (reading 'sys')`, and the place never changed on travel; the error shows only as a page error.
Verify: apps/agent-world/tests/world-fidgets.test.ts

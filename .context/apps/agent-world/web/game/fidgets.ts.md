## file

Fidgets are presentation only (ticket 29, decision 27): nothing here may call `window.agentWorld`, send an intent that reaches the backend, or store anything in the runtime. A light's or box's on/open state lives in a module-level map keyed `theme:placeKey:slot index`, so it lasts while the app runs and resets on restart. `fidgets.test.ts` drives every play through the real backend API and fails on any command, runtime row, integration call, or outside request.
Verify: apps/agent-world/tests/fidgets.test.ts, apps/agent-world/tests/world-fidgets.test.ts

`views()` (`window.agentWorldView.fidgets()`) is what the headless tests read to tell a play happened (`art`, `on`, `playing`, `angle`, `speed`, `particles`, `glow`, `line`, and a pet's `look` and `asleep`); renaming a field breaks them without a type error. Its `h` is the sprite shown now at the fidget's pixel size, so a pet sitting up reports its sitting height, which `world-pets.test.ts` compares with a standing character's.
Coupled: apps/agent-world/web/main.tsx
Verify: apps/agent-world/tests/world-fidgets.test.ts, apps/agent-world/tests/world-pets.test.ts

## symbol:Fidgets.romp

A pet's poses are named by its style's `frames` (the kind's own `pet-0..3` are sit, petted, stretch, play; the looks' are sit, petted, play, sleep), never by sprite number: `pet-2` is a stretch for one pet and a playful pose for another. An asleep pet (`slot.asleep`) rests on its sleep frame with the sleeper's breathing tween in `bob`, which a wake must remove and `settle` puts back.
Verify: apps/agent-world/tests/world-pets.test.ts

## symbol:Fidgets.stop

Runs on scene shutdown, after Phaser has already destroyed the images: it only removes timers and tweens.
Why: settling a fidget there (setting its texture back) threw `Cannot read properties of undefined (reading 'sys')`, and the place never changed on travel; the error shows only as a page error.
Verify: apps/agent-world/tests/world-fidgets.test.ts

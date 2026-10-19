## file

The cast is presentation only: its actions call `approach`, `notify`, and its own walker, never `view.intend`, a panel store, or `window.agentWorld`. `tests/ambient.test.ts` proves it against the real backend (no command, no database row, no `places:*` call, no request); a new action here that reaches the backend breaks that test.
Verify: apps/agent-world/tests/ambient.test.ts

`Patter` counts a click when Talk to is chosen and picks the line when the avatar arrives: repeated clicks while it walks replace the walk's callback, so only the last arrival speaks, and the streak still counts every click. Lines and reactions advance in a module-level map keyed by theme and cast name, so a member goes on where it left off after the scene restarts (every travel or relayout restarts it).
Verify: apps/agent-world/tests/ambient-pack.test.ts

Cast homes are footprints in the scene's walk grid, the wanderers' footprints, and `clearOfOthers` (the scene's `occupied()` lists), so the pack check keeps them clear of spots, the host, the recruiter, and points of interest; a home on a spot would put a townsperson inside a cast member. Posted members (`stay`) never join `Wander`, so the life tests can hold them still.
Coupled: apps/agent-world/web/game/place-scene.ts, apps/agent-world/src/theme-pack.ts
Verify: apps/agent-world/tests/world-ambient.test.ts

Barks run on `lifePace()` like idles and strolls, so the headless suites never see one unless a test sets a pace. A cast bark shows only where its bubble is on screen and clear of the interface and the agents' barks (the scene's `covered` hook), one cast member at a time; the scene's own bark placement treats `barkBoxes()` as taken, so the agents' barks, which need the operator, are never hidden by a cast bark.
Coupled: apps/agent-world/web/game/place-scene.ts

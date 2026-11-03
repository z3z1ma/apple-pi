## symbol:appFile

Electron's app:// handler and the headless Chrome tests both resolve URLs through this map, so a built file and a test request cannot drift apart. A path that would leave the theme-pack directory or the built UI is undefined, including encoded `..`.
Why: serving a path outside those two roots would expose repository files through the app protocol.
Coupled: apps/agent-workplace/src/electron/main.ts
Verify: apps/agent-workplace/tests/build.test.ts

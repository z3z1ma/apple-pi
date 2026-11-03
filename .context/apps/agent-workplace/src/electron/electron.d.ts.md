## file

This is the part of Electron's API Agent Workplace uses. Electron is installed on first launch, not as an apple-pi dependency, so its own type definitions are not installed. Extend this declaration when the app needs more of the API.
Why: importing `electron` must still typecheck in a checkout that has not installed Electron yet.
Coupled: apps/agent-workplace/src/electron/main.ts, apps/agent-workplace/src/launch.ts
Verify: apps/agent-workplace/tests/build.test.ts

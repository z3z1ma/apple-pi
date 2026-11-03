## file

Theme authors run this from the repository root. With no directory it checks every pack under `apps/agent-workplace/themes/`. Each problem prints as `<pack>/<file>: <fault>`, and the process exits 1 when any pack has one.
Why: a pack check has to name the file and the fault without starting Electron or the world UI.
Coupled: apps/agent-workplace/src/theme-pack.ts, apps/agent-workplace/src/backend/theme-packs.ts
Verify: apps/agent-workplace/tests/theme-pack.test.ts

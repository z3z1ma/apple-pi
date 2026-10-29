## file

The fixture seeds temporary-identity history and legacy launch ownership into an isolated runtime database after admitting fake bridges. Assertions use only the public World snapshot, including its dormant roster after a reader restart.
Why: this test exercises the metadata reader over retained evidence without launching real Pi workers or relying on present-day launch admission to reconstruct older identity states. Separate runtime lifecycle tests own whether temporary people may reconnect.
Coupled: apps/agent-world/src/backend/world-backend.ts, apps/agent-world/src/backend/inn.ts

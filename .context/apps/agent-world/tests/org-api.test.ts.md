## file

These tests exercise the public Org payload guards used by Electron IPC: valid drafts, explicit splits/subset choices, and malformed required/optional fields. They check shape acceptance, not reporting authorization, catalog availability, or startup outcomes; those belong to controller/runtime tests.
Why: accepting a malformed renderer payload must fail at the IPC boundary, while refusing a well-typed but unsafe move requires current runtime state. Mixing those responsibilities would make guard tests require an invented organization or duplicate runtime policy.

The suite imports no Electron host and does not prove handler registration, preload forwarding or navigation behavior. Integrated typecheck checks API compatibility; real-host tests own those execution seams.

Coupled: apps/agent-world/src/org.ts, apps/agent-world/src/electron/main.ts
Verify: apps/agent-world/tests/org-api.test.ts, apps/agent-world/tests/org-backend.test.ts

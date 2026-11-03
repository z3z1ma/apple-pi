## file

The runtime runs this package's TypeScript directly through Node's type stripping, so every file it loads must use only erasable syntax (no parameter properties, enums, or namespaces) and must import types with `import type`.
Why: Node strips types without transforming code; a parameter property fails to parse, and a plain named import of a type-only name fails at link time because the export does not exist at runtime. `tsc` accepts both, so only a spawned runtime shows the failure.
Coupled: components/session-state/src/register.mjs, components/session-state/src/runtime.ts, components/session-state/src/paths.ts, components/session-state/src/protocol.ts, components/session-state/src/schema.ts
Verify: components/session-state/tests/runtime.test.ts

Exit code 0 means another runtime holds the lock; any other exit code is a failed start.
Why: the bridge warns the session only on a non-zero exit, so several bridges starting runtimes at once stay quiet.
Coupled: components/session-state/src/bridge.ts

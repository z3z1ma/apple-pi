## file

The runtime runs this package's TypeScript directly through Node's type stripping, so every file it loads must use only erasable syntax (no parameter properties, enums, or namespaces) and must import types with `import type`.
Why: Node strips types without transforming code; a parameter property fails to parse, and a plain named import of a type-only name fails at link time because the export does not exist at runtime. `tsc` accepts both, so only a spawned runtime shows the failure.
Coupled: components/session-state/src/register.mjs, components/session-state/src/runtime.ts, components/session-state/src/paths.ts, components/session-state/src/protocol.ts, components/session-state/src/schema.ts
Verify: components/session-state/tests/runtime.test.ts

Test suites spawn runtimes against temporary state directories, and an interrupted run can leave them alive for days. Identify each runtime by the database it serves before stopping it: list them with `ps -eo pid,etime,command | grep runtime-main`, then `lsof -p <pid> | grep -o '/[^ ]*apple-pi\.db'`. Test runtimes serve `.../T/aps-*/state/apple-pi.db`; the operator's live runtime is the pid in `~/.pi/agent/state/apple-pi-runtime.pid` and serves `~/.pi/agent/state/apple-pi.db`.
Why: every runtime runs the same command line, so only the open database tells a stale test daemon from the live one.

Exit code 0 means another runtime holds the lock; any other exit code is a failed start.
Why: the bridge warns the session only on a non-zero exit, so several bridges starting runtimes at once stay quiet.
Coupled: components/session-state/src/bridge.ts

## file

A started runtime is detached and keeps running after the caller ends. Its output goes to the runtime log. Exit 0 means another runtime already runs; any other code is a failed start. An explicit socket connects without starting a daemon. `until: "accepted"` settles when the runtime has stored the command, which is enough for mail; otherwise the receipt is applied or failed.
Why: several callers starting runtimes at once must stay quiet when one already holds the lock, and mail is stored before a sleeping recipient applies it.
Renaming the runtime entry file strands sessions loaded before the rename: their bridges still spawn the old path and fail with `ERR_MODULE_NOT_FOUND` when the runtime dies. After such a rename, stop the old runtime and start the new entry yourself through this module's `spawnRuntime` from the current checkout, confirm a stable pid and working mail, and ask the operator to reload old sessions.
Why: during the `runtime-main.runtime.ts` rename, 39 bridge respawns failed; waiting for bridges to restart it would have left no runtime.

To act as the operator, or to use a command field that a running session's older tool schema lacks, call `sendCommand(sessionId | "operator", command, { commandId, until })` from a `/tmp/*.mjs` script run with `node --import ./components/session-state/src/register.mjs`, importing this module by its absolute `.ts` path. Examples that worked: `{ kind: "retire", by: "operator", reason, handoff: false }` (refused while the person holds an assignment), `{ kind: "work", action: "unassign", person, task, cwd }` sent as `"operator"`, and a review `enqueue` operation with a unique `review:<owner>:<id>` command id.
Why: the runtime owns the commands; a tool schema loaded at session start lags the checkout until reload.

Coupled: components/session-state/src/runtime-main.runtime.ts, components/session-state/src/bridge.ts
Verify: components/session-state/tests/runtime.test.ts

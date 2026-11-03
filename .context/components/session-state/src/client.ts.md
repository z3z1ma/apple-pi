## file

A started runtime is detached and keeps running after the caller ends. Its output goes to the runtime log. Exit 0 means another runtime already runs; any other code is a failed start. An explicit socket connects without starting a daemon. `until: "accepted"` settles when the runtime has stored the command, which is enough for mail; otherwise the receipt is applied or failed.
Why: several callers starting runtimes at once must stay quiet when one already holds the lock, and mail is stored before a sleeping recipient applies it.
Renaming the runtime entry file strands sessions loaded before the rename: their bridges still spawn the old path and fail with `ERR_MODULE_NOT_FOUND` when the runtime dies. After such a rename, stop the old runtime and start the new entry yourself through this module's `spawnRuntime` from the current checkout, confirm a stable pid and working mail, and ask the operator to reload old sessions.
Why: during the `runtime-main.runtime.ts` rename, 39 bridge respawns failed; waiting for bridges to restart it would have left no runtime.

Coupled: components/session-state/src/runtime-main.runtime.ts, components/session-state/src/bridge.ts
Verify: components/session-state/tests/runtime.test.ts

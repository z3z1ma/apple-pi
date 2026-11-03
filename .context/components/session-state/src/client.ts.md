## file

A started runtime is detached and keeps running after the caller ends. Its output goes to the runtime log. Exit 0 means another runtime already runs; any other code is a failed start. An explicit socket connects without starting a daemon. `until: "accepted"` settles when the runtime has stored the command, which is enough for mail; otherwise the receipt is applied or failed.
Why: several callers starting runtimes at once must stay quiet when one already holds the lock, and mail is stored before a sleeping recipient applies it.
Coupled: components/session-state/src/runtime-main.runtime.ts, components/session-state/src/bridge.ts
Verify: components/session-state/tests/runtime.test.ts

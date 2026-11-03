## file

One Monty interpreter belongs to the current Pi session branch. Python globals persist across runs and are checkpointed after every usable run. Switching branches discards the interpreter; the next run restores that branch's latest checkpoint. An unusable run rolls back to the last checkpoint. `reset` starts from empty Python state and checkpoints that before running. A restore failure is reported once, on the next run.
Why: branch state must not leak across a switch, and an unusable run must not become the next checkpoint.

Discarding the owner increments a generation so in-flight work can see that its session went away. Monty counts suspensions across a checkout, so a run whose call budget would pass the package maximum discards the interpreter and rebases from the last checkpoint before the next run.
Why: continuing on the old interpreter could exhaust Monty's suspension count, and in-flight work must not use a discarded owner.

Checkpoint compatibility includes both the callable Python declarations and the built-in prelude. A dump retains Python class and function implementations, so hashing only signatures could restore an old Peer method after its implementation was fixed. A changed prelude starts a fresh interpreter with the existing incompatibility notice.

Coupled: components/pi-exec/src/program.ts, components/pi-exec/src/peer-python.ts, components/pi-exec/src/checkpoint.ts
Verify: components/pi-exec/tests/session.test.ts, components/pi-exec/tests/peer-python.test.ts

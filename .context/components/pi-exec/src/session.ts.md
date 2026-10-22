## file

Checkpoint compatibility includes both the callable Python declarations and the built-in prelude. A dump retains Python class and function implementations, so hashing only signatures could restore an old Peer method after its implementation was fixed. A changed prelude starts a fresh interpreter with the existing incompatibility notice.

Coupled: components/pi-exec/src/program.ts, components/pi-exec/src/peer-python.ts, components/pi-exec/src/checkpoint.ts
Verify: components/pi-exec/tests/session.test.ts, components/pi-exec/tests/peer-python.test.ts

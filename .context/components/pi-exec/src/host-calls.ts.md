## file

Closing a peer is a control request: it still consumes call budget, but bypasses the work semaphore. Otherwise a running turn can hold the last slot while its own cancellation queues behind it. Invocation cleanup also runs outside the semaphore and completes before the final trace and usage snapshot.

Coupled: components/pi-exec/src/peer-calls.ts, components/pi-exec/src/index.ts
Verify: components/pi-exec/tests/peer-calls.test.ts

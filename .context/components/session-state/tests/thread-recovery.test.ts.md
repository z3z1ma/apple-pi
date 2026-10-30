## file

Seeded accepted/committed journal snapshots establish startup replay boundaries, not OS-crash proof. Same-ID canonical replay returns the recorded stage without republishing; changed canonical input refuses that request and leaves the original command/result untouched. A publication failure must roll back the summary and closure together.
Coupled: components/session-state/src/runtime.ts, components/session-state/src/threads.ts
Verify: components/session-state/tests/thread-recovery.test.ts

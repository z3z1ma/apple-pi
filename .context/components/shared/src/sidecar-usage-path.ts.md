## file

Keep this path contract usable by the Node-only workplace runtime as well as the Pi sidecar producer. Importing the producer to obtain filenames would also load the Pi SDK into the daemon. Existing file naming and rotation ownership must stay aligned across recording and permanent-departure cleanup; the producer tests check independently expected on-disk locations rather than deriving expectations through this helper.
Why: source organization changed so cleanup can reuse the existing layout, not migrate unrelated usage records or introduce an SDK dependency into the runtime.

A sanitized filename is not proof of exclusive ownership: different raw IDs can map to the same name, and `unscoped.ndjson` deliberately pools records without a usable ID. Cleanup must leave shared or ambiguously owned files alone instead of treating every returned path as safe to delete.
Why: applying the recording fallback as a deletion fallback would remove other sessions' runtime evidence.

Coupled: components/shared/src/sidecar-usage.ts, components/session-state/src/departures.ts
Verify: components/shared/tests/sidecar-usage.test.ts, components/session-state/tests/departures.test.ts

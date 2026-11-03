## file

The stand-in runtime accepts the bridge and then stops reading.
Why: a runtime that keeps reading would hide the backpressure the test is there to show.
Verify: components/session-state/tests/bridge-backpressure.test.ts

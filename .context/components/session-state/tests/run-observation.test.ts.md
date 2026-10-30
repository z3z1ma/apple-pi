## file

Start and await the isolated runtime before the host scenarios; use the actual SDK for consumption, continuation, abort and idle reload. Journal assertions inspect durable typed observations, and the continuation scenario also reads the result through registered progress.
Why: observer-only tests cannot prove hook wiring or native report delivery. Explicit runtime setup keeps a consumption test from also depending on an uncaptured daemon-boot race; a passing rerun does not explain the earlier initialization timeout.

The native report fixes its cutoff after the completed response but before the inspecting response starts. Wait for the millisecond clock to pass the settlement timestamp rather than guessing a delay.
Why: otherwise self-observation can include the inspection's own run, or the half-open window can exclude a settlement stamped in the same millisecond. The fixture proves one high-level run despite multiple SDK loops, not a provider-specific latency or autonomous interpretation.
Coupled: tests/helpers/faux-session.ts, components/session-state/tests/helpers.ts, components/session-state/src/run-observation.ts, components/session-state/src/bridge.ts, components/session-state/src/work-tools.ts
Verify: components/session-state/tests/run-observation.test.ts

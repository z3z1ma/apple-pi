## file

The watchdog assertion observes the CLI arguments received by the spawned worker, rather than the runner's local array. It verifies that the explicit subprocess loadout carries the safety extension; it does not prove request timeout or retry behavior inside a real intern.
Why: intern extension discovery is disabled, and a process-wide watchdog in the caller cannot observe another process. Removing the explicit extension argument must break this wiring regression even while root-session watchdog tests stay green. Actual transport deadlines and native retries are covered separately by the watchdog integration suites.

Coupled: components/interns/src/runner.ts, extensions/anthropic-watchdog.ts, tests/fixtures/intern-worker.mjs
Verify: components/anthropic-watchdog/tests/watchdog.test.ts, components/anthropic-watchdog/tests/ownership.test.ts

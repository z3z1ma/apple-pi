## file

The Community Modules are pinned to a release whose `.tla` sources are extracted from its jar and given to TLC through `-DTLA-Library`; the jar itself never goes on the classpath. Why: every Community Modules release carries Java overrides built against TLC nightly, and TLC 1.7.4 loads them at startup and crashes (`NoClassDefFoundError: KSubsetValue`), even releases from September 2024. TLC 1.8.0 is a prerelease whose assets are republished, so it cannot be pinned by checksum. Without the overrides the modules run as plain TLA+, slower but correct; modules whose operators exist only in Java (IOUtils, Json, CSV) do not work.

`pass` requires exit code 0, TLC's "No error has been found" line and an empty queue. `-Dtlc2.TLC.stopAfter` stops a search gracefully and still prints "No error has been found" with states left on the queue, and a depth-first search that reaches its bound prints no completion line at all; both are `incomplete`, as is every simulation without a violation. Coverage (`-coverage`) is always on: it costs a few percent and its per-action `distinct:total` counts reveal actions whose total is 0, which never took a step. Depth-first iterative deepening supports only one worker.

Anything unrecognized is `error` with the first error line, so a parse failure, a missing Java or a crash is never read as success. The verdict comes from TLC's text output (TLC 2.19), not its exit codes alone. Numbers may carry thousands separators. A violation's trace is parsed from the `State n: <action>` blocks (depth-first traces omit the action); a value that wraps onto further lines is joined onto its variable.
Why: the counterexample-to-test loop needs the trace as data, and a runner that swallowed TLC's failures would make every model look correct.

Coupled: components/tla/src/index.ts, components/tla/src/toolchain.ts, skills/formal-verification/SKILL.md, tests/formal-verification.test.ts, tests/lifecycle-models.test.ts
Verify: components/tla/tests/tlc.test.ts, tests/formal-verification.test.ts

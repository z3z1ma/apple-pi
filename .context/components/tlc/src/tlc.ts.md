## file

The pinned JAR checksum was calculated from the official v1.7.4 release asset fetched over HTTPS. It detects changed downloads and cache corruption; it is not an independently signed upstream attestation. Keep version, URL and checksum aligned when updating the toolchain. A concurrent first use writes through a per-process temporary file, so no reader sees a partly downloaded JAR.

TLA+ module identifiers cannot contain hyphens, so the spec and every other `.tla` file in its directory are staged in a scratch directory under their declared module names, with the config beside them. TLC's state files stay there and are removed afterwards.

The Community Modules are pinned to a release whose `.tla` sources are extracted from its jar and given to TLC through `-DTLA-Library`; the jar itself never goes on the classpath. Why: every Community Modules release carries Java overrides built against TLC nightly, and TLC 1.7.4 loads them at startup and crashes (`NoClassDefFoundError: KSubsetValue`), even releases from September 2024. TLC 1.8.0 is a prerelease whose assets are republished, so it cannot be pinned by checksum. Without the overrides the modules run as plain TLA+, slower but correct; modules whose operators exist only in Java (IOUtils, Json, CSV) do not work.

`pass` requires exit code 0, TLC's "No error has been found" line and an empty queue. `-Dtlc2.TLC.stopAfter` stops a search gracefully and still prints "No error has been found" with states left on the queue, and a depth-first search that reaches its bound prints no completion line at all; both are `incomplete`, as is every simulation without a violation. Coverage (`-coverage`) is always on: it costs a few percent and its per-action `distinct:total` counts reveal actions whose total is 0, which never took a step. Depth-first iterative deepening supports only one worker.

Constant overrides rewrite the copied `.cfg`: each live `Name = value` (or `<-`) is replaced in place, skipping `\*` comment lines, or a `CONSTANT` line is appended. A value is consumed as a `{...}` set (possibly spanning lines), a string, or one token.

Anything unrecognized is `error` with the first error line, so a parse failure, a missing Java or a crash is never read as success. The verdict comes from TLC's text output (TLC 2.19), not its exit codes alone. Numbers may carry thousands separators. A violation's trace is parsed from the `State n: <action>` blocks (depth-first traces omit the action); a value that wraps onto further lines is joined onto its variable.
Why: the counterexample-to-test loop needs the trace as data, and a runner that swallowed TLC's failures would make every model look correct.

Cancellation checks `signal.aborted` right after attaching its abort listener.
Why: a signal aborted while the JAR was being verified or the scratch directory staged never fires a listener added later, so Java would run the whole search after the caller had cancelled.

Coupled: components/tlc/src/index.ts, skills/formal-verification/SKILL.md, tests/formal-verification.test.ts, tests/lifecycle-models.test.ts
Verify: components/tlc/tests/tlc.test.ts, tests/formal-verification.test.ts

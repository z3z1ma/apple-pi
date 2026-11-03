## file

The pinned JAR checksum was calculated from the official v1.7.4 release asset fetched over HTTPS. It detects changed downloads and cache corruption; it is not an independently signed upstream attestation. Keep version, URL and checksum aligned when updating the toolchain. A concurrent first use writes through a per-process temporary file, so no reader sees a partly downloaded JAR.

TLA+ module identifiers cannot contain hyphens, so a spec is staged in a scratch directory under its declared module name, with its config beside it. TLC's state files stay there and are removed afterwards. Only a single module with standard-library dependencies is supported.

`pass` requires both exit code 0 and TLC's "No error has been found" line. Anything unrecognized is `error` with the first error line, so a parse failure, a missing Java or a crash is never read as success. The verdict comes from TLC's text output (TLC 2.19), not its exit codes alone. A violation's trace is parsed from the `State n: <action>` blocks; a value that wraps onto further lines is joined onto its variable.
Why: the counterexample-to-test loop needs the trace as data, and a runner that swallowed TLC's failures would make every model look correct.

Coupled: components/tlc/src/index.ts, skills/formal-verification/SKILL.md, tests/formal-verification.test.ts, tests/lifecycle-models.test.ts
Verify: components/tlc/tests/tlc.test.ts, tests/formal-verification.test.ts

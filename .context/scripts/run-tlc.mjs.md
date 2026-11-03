## file

The pinned JAR checksum was calculated from the official v1.7.4 release asset fetched over HTTPS. It detects changed downloads and cache corruption; it is not an independently signed upstream attestation. Keep version, URL and checksum aligned when updating the toolchain.

TLA+ module identifiers cannot contain hyphens, so the runner stages the declared module name separately from the repository filename. Only a single module with standard library dependencies is supported. TLC metadata belongs in that disposable directory, not beside the checked-in spec. Cache replacement uses a per-process temporary file so concurrent first uses cannot read a partly downloaded JAR.
Why: a packaged skill must work without vendoring a binary or dirtying the checkout, and a parser failure or broken cache must remain a failing check rather than a success-shaped result.

Coupled: specs/command-journal.tla, specs/command-journal.cfg, specs/README.md, skills/formal-verification/SKILL.md, package.json
Verify: tests/formal-verification.test.ts, tests/package-load.mjs

## file

Pinned checksums were calculated from the official release assets fetched over HTTPS. They detect changed downloads and cache corruption; they are not independently signed upstream attestations. Keep each version, URL and checksum aligned when updating a tool. A first use writes through a per-process temporary file, so a concurrent reader never sees a partly downloaded file.

TLA+ module identifiers cannot contain hyphens, so the spec and every other `.tla` file in its directory are staged in a scratch directory under their declared module names. The tools' own state files stay there and are removed afterwards.

Constant overrides rewrite a copy of the `.cfg`: each live `Name = value` (or `<-`) is replaced in place, skipping `\*` comment lines, or a `CONSTANT` line is appended. A value is consumed as a `{...}` set (possibly spanning lines), a string, or one token.

Cancellation checks `signal.aborted` right after attaching its abort listener.
Why: a signal aborted while a JAR was being verified or the scratch directory staged never fires a listener added later, so Java would run the whole check after the caller had cancelled.

Coupled: components/tla/src/tlc.ts, components/tla/src/apalache.ts
Verify: components/tla/tests/tlc.test.ts, components/tla/tests/apalache.test.ts

## file

Pinned checksums were calculated from the official release assets fetched over HTTPS. They detect changed downloads and cache corruption; they are not independently signed upstream attestations. Keep each version, URL and checksum aligned when updating a tool. A first use writes through a uniquely named temporary file, so a concurrent reader never sees a partly downloaded file and two first uses in one process do not share one.

TLA+ module identifiers cannot contain hyphens, so the spec and every other `.tla` file in its directory are staged in a scratch directory under their declared module names. The tools' own state files stay there and are removed afterwards.

Constant overrides rewrite a copy of the `.cfg`: each live `Name = value` (or `<-`) is replaced in place, skipping `\*` comment lines, or a `CONSTANT` line is appended. A value is consumed as a `{...}` set (possibly spanning lines), a string, or one token.

Cancellation checks `signal.aborted` right after attaching its abort listener.
Why: a signal aborted while a JAR was being verified or the scratch directory staged never fires a listener added later, so Java would run the whole check after the caller had cancelled.

Each process starts in its own process group (`detached`). Cancellation and the time limit send SIGTERM to the whole group, then SIGKILL after a grace period. After the direct child closes, for any reason, the call waits until the group is gone (SIGTERM, then SIGKILL after the grace period, then gives up after one more), because a descendant that detached its output does not delay `close`.
Why: Lake, elan and wrapper scripts start descendants that hold stdout and stderr open; killing only the direct child left the call waiting for `close` forever when a descendant survived or a child ignored SIGTERM, and the caller's scratch cleanup never ran. The grace period is not tuned; it only needs to let a well-behaved process finish writing.

`runProcess` always pipes stdin and ends it (with the caller's input or nothing). Its stdin error handler is deliberately empty: a child that exits before reading its input raises EPIPE there, and the child's own `error` and `close` events already report the failure.

Coupled: components/formal-verification/src/tlc.ts, components/formal-verification/src/apalache.ts, components/formal-verification/src/alloy.ts, components/formal-verification/src/lean.ts
Verify: components/formal-verification/tests/tlc.test.ts, components/formal-verification/tests/apalache.test.ts, components/formal-verification/tests/alloy.test.ts, components/formal-verification/tests/lean.test.ts

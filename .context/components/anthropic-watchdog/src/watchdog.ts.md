## file

Undici's bodyChunkReceived diagnostics contain wire bytes, including compression. Pi's configureHttpDispatcher installs npm Undici fetch; the installed HTTPS transport advertises Brotli, gzip, deflate and Zstandard. Match its actual negotiated encodings rather than assuming Node's initial fetch or an older three-encoding list; the disposable configured-transport tests cover this boundary. Provider stream hooks cannot enforce the first-event deadline: Pi filters pings before exposing them, and extension-handler errors do not fail the request. The request's own abort(error) reaches the native retryable transport-error path; aborting the user's signal instead produces nonretryable cancellation.

The shared service lives on globalThis under Symbol.for because Pi can load the extension through separate module graphs in one process. Ownership is refcounted, while timers and decoders belong to individual HTTP requests. The final owner releases all subscriptions/state. Releasing one owner leaves the one shared enforcer alive for other sessions.

Keep timeout enforcement on complete non-ping frames rather than byte activity or user-visible text. The45s and15min values are the operator's policy;15min is not evidence of remote death. Preserve native provider/accounting/retry behavior and the distinction between response lifetime and subsequent local tools. Decoder failures release watcher state; the native HTTP reader owns surfacing malformed response errors.

Coupled: components/anthropic-watchdog/src/index.ts, components/anthropic-watchdog/src/sse-progress.ts, extensions/anthropic-watchdog.ts, docs/anthropic-watchdog.md
Verify: components/anthropic-watchdog/tests/watchdog.test.ts, components/anthropic-watchdog/tests/ownership.test.ts

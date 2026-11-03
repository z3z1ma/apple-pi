## file

The page listens on 127.0.0.1 only. Every request must carry the session token (`t` on the page, `x-page-token` on posts) and address that loopback host. A session closed before anyone awaits its result must not surface as an unhandled rejection.
Why: another local origin must not read the page or submit the reviewer's answer. An abandoned session is cancellation, not a crash.
Coupled: components/browser-pages/web/connected.ts, components/browser-pages/src/index.ts
Verify: components/browser-pages/tests/page-server.test.ts

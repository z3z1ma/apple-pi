## file

The saved copy is for sharing: no session and no reader state, so it reads as a plain page anywhere.
Why: a saved page must not keep a live token or the reviewer's private draft.

A call cancelled while the page is being built neither saves nor opens it. Rendering that outlasts a cancellation publishes nothing.
Why: a cancelled review must not leave a saved page or open a browser for a result nobody is waiting for.
Coupled: components/browser-pages/src/page-server.ts

## symbol:openInBrowser

Runs the bare command name (`open`, `explorer`, `xdg-open`), so it resolves through `PATH`, and has no test switch.
Why: the tests put stub `open` and `xdg-open` scripts first on `PATH`; the stubs post to the page's endpoints, which drives `execute()` end to end. An absolute path would open a real browser and leave the test waiting for a submission.

Verify: components/browser-pages/tests/code-review.test.ts

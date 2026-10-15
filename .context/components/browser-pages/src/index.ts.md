## symbol:openInBrowser

Runs the bare command name (`open`, `explorer`, `xdg-open`), so it resolves through `PATH`, and has no test switch.
Why: the tests put stub `open` and `xdg-open` scripts first on `PATH`; the stubs post to the page's endpoints, which drives `execute()` end to end. An absolute path would open a real browser and leave the test waiting for a submission.

Verify: components/browser-pages/tests/code-review.test.ts

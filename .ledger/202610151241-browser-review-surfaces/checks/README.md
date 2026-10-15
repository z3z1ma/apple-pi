# Manual visual check of the code review page

`demo-review.test.ts` builds a real page from a generated demo repository (the retry change from the prototypes), serves it, and waits for a browser to submit. `drive-demo.py` drives the page in system Chrome with Playwright, takes screenshots, submits a review, and opens the saved page in dark mode.

```bash
cp .ledger/202610151241-browser-review-surfaces/checks/demo-review.test.ts components/browser-pages/tests/demo.local.test.ts
rm -rf /tmp/bp && (DEMO_OUT=/tmp/bp npx vitest run components/browser-pages/tests/demo.local.test.ts &) ; sleep 1
uv run -w playwright python .ledger/202610151241-browser-review-surfaces/checks/drive-demo.py   # screenshots in /tmp/bp/shots
rm components/browser-pages/tests/demo.local.test.ts   # it waits for a submission, so it must not stay in the suite
```

`/tmp/bp/result.txt` holds the text the agent receives; `/tmp/bp/saved.html` is the saved page.

The Markdown review has the same pair: `demo-markdown.test.ts` (a retry spec with Mermaid, alerts, a table, hostile HTML and links, and long appendices) and `drive-markdown.py` (every annotation kind, ask, rewrite, `J`/`K`, dark theme, submit, saved page, `?`). Use `/tmp/bpm` in place of `/tmp/bp`.

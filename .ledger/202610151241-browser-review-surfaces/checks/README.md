# Manual visual check of the code review page

`demo-review.test.ts` builds a real page from a generated demo repository (the retry change from the prototypes), serves it, and waits for a browser to submit. `drive-demo.py` drives the page in system Chrome with Playwright, takes screenshots, submits a review, and opens the saved page in dark mode.

```bash
cp .ledger/202610151241-browser-review-surfaces/checks/demo-review.test.ts components/browser-pages/tests/demo.local.test.ts
rm -rf /tmp/bp && (DEMO_OUT=/tmp/bp npx vitest run components/browser-pages/tests/demo.local.test.ts &) ; sleep 1
uv run -w playwright python .ledger/202610151241-browser-review-surfaces/checks/drive-demo.py ; rm -f components/browser-pages/tests/demo.local.test.ts
```

The copy waits for a submission, so a copy left in the tree hangs `npx vitest run components/browser-pages` until it times out. Remove it in the same command, after `;` (not `&&`), so it goes even when the drive fails. A page embeds its build when its session starts: after `npm run build:web`, stop the old server and start a new one.

`/tmp/bp/result.txt` holds the text the agent receives; `/tmp/bp/saved.html` is the saved page.

The Markdown review has the same pair: `demo-markdown.test.ts` (a retry spec with Mermaid, alerts, a table, hostile HTML and links, and long appendices) and `drive-markdown.py` (every annotation kind, ask, rewrite, `J`/`K`, dark theme, submit, saved page, `?`). Use `/tmp/bpm` in place of `/tmp/bp`.

The ledger task review has `demo-ledger.test.ts` (serves the real closed `branch-search-challenger-benchmark` bundle, with evidence files on demand) and `drive-ledger.py` (graph, ticket, annotation, ask, evidence, navigation, finish, saved page). Use `/tmp/bpl`.

The explanation has `demo-explain.test.ts`: it serves the explanation of `72c7ad3` from `explain-demo.json` (the prototype's content) through the real server, with a stand-in tutor, and writes the saved copy, the tutor turns, and the notes to `/tmp/bpx`. Drive it with Playwright as for the others. To end its session mid-test, kill the process that holds the page's port (`lsof -ti tcp:<port> -sTCP:LISTEN`); killing the Vitest parent leaves the worker, and the server, running. Stop every demo server the same way, and confirm with a request to `/health`.

## Driving tips

- Scroll the `.stage` element yourself (`stage.scrollTop += rect.top - innerHeight / 2`) before you select text. `scrollIntoView` also scrolls the body, which shifts the app in screenshots, and a selection below the fold opens its toolbar outside the viewport.
- When a submission fails, record the `/result` request body and the response (`page.on('request')`). The page says 'Could not reach the agent' also when the server rejected the body with a 400, and a missing `saved.html` can mean the same rejection.

## README screenshots

The images in `media/readme/` come from these demos: a 1440x900 viewport at device scale 2, given rounded corners and a 2px border with Pillow, and saved as lossless WebP. For these flat-colour pages, lossless WebP was smaller than quality-92 lossy WebP and kept every pixel.

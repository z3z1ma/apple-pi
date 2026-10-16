## symbol:blocksIn

An evidence file has no Markdown blocks: its spans name lines as `l<N>`, 1-based, the id `EvidenceLine` gives each line's `data-content` in the page. `blocksIn`, `where`, and `ledgerPassage` here, and `position`/`lineOf` in the ledger app, all read that form, and `blocksIn` accepts it only once `serveEvidence` has stored the file's lines on this same page object.
Why: the line count exists only after the page asked for the file, so an annotation on evidence never served is rejected; the saved page in `index.ts` spreads this page object, so it keeps the served lines.

Coupled: components/browser-pages/web/ledger/parts.tsx, components/browser-pages/web/ledger/app.tsx, components/browser-pages/src/index.ts
Verify: components/browser-pages/tests/ledger-review.test.ts

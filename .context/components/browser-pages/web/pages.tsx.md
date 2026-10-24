## symbol:Prose

`Prose` only draws a Mermaid diagram when the page's HTML carries the Mermaid script, which `codeReviewTemplate` inlines only when the intent, focus, or a brief has a `mermaid` block. A new place that renders agent Markdown on the code review page must add its blocks to that template's list.
Why: `drawDiagrams` silently does nothing when `window.mermaid` is absent, so a missed block renders as plain text with no error.

Coupled: components/browser-pages/src/code-review.ts, components/browser-pages/web/code-review.tsx, components/browser-pages/web/styles.css
Verify: components/browser-pages/tests/code-review.test.ts

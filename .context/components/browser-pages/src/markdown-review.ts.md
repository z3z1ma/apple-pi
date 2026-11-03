## file

Annotation offsets index the text the page rendered, which can be longer than the source because marked adds a newline after elements. Only their shape is checked. The model gets lines and quotes, not those offsets.
Why: rejecting an offset past the source length would refuse a valid highlight on a table.

## symbol:withDiagrams

Mermaid stays out of the Vite bundle. `npm run build:web` copies Mermaid's standalone `mermaid.min.js` into `dist/`, and this function inlines it only into pages that have a diagram; `web/markdown/mermaid.ts` reads `window.mermaid`.
Why: the single-file plugin inlines dynamic imports too, so a lazy `import("mermaid")` would still put Mermaid in every page and every saved copy. After a change, check that a diagram page renders and that a page without diagrams is much smaller.

Coupled: package.json, components/browser-pages/web/markdown/mermaid.ts

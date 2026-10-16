## symbol:withDiagrams

Mermaid stays out of the Vite bundle. `npm run build:web` copies Mermaid's standalone `mermaid.min.js` into `dist/`, and this function inlines it only into pages that have a diagram; `web/markdown/mermaid.ts` reads `window.mermaid`.
Why: the single-file plugin inlines dynamic imports too, so a lazy `import("mermaid")` would still put Mermaid in every page and every saved copy. After a change, check that a diagram page renders and that a page without diagrams is much smaller.

Coupled: package.json, components/browser-pages/web/markdown/mermaid.ts

## file

A rendered block is memoized so React does not replace the DOM while highlights and Mermaid diagrams decorate it. Text offsets index the original rendered block, not the marked DOM.
Why: replacing the block DOM on unrelated parent state changes drops active text selections and invalidates live mark ranges.
Coupled: components/browser-pages/web/markdown/marks.ts, components/browser-pages/web/markdown/render.ts
Verify: components/browser-pages/tests/markdown-marks.test.ts

## file

The Vite mode names the page to build. Each kind is its own self-contained file, so only the Markdown page carries Mermaid.
Why: the other pages do not draw diagrams, and each built file is what the package ships.
Coupled: components/browser-pages/web/markdown/mermaid.ts, package.json
Verify: components/browser-pages/tests/page-build.test.ts

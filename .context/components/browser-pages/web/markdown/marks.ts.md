## symbol:textNodes

The text these nodes hold is the coordinate space of every span offset: `readSelection` writes offsets in it, `applyMarks` reads them, and a saved page replays them. Every element the page adds that is not document text (the code language tag and alert title from `render.ts`, the Mermaid box, `.deco` marks) must be excluded here. A rewritten block drops `data-content` in `parts.tsx`, so its rewrite never enters this space.
Why: the server cannot check offsets because it does not render Markdown. A new decoration missing from this list shifts offsets silently, and saved highlights land on the wrong text.

Coupled: components/browser-pages/web/markdown/render.ts, components/browser-pages/web/markdown/parts.tsx, components/browser-pages/src/markdown-review.ts
Verify: components/browser-pages/tests/markdown-marks.test.ts

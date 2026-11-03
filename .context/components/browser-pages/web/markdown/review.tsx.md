## file

Highlights are DOM decorations over rendered blocks and reapply after each render. Long stage jumps land immediately rather than smooth-scrolling across thousands of lines.
Why: a smooth scroll over large files delays the user's answer and risks landing mid-scroll when newer elements render.
Coupled: components/browser-pages/web/markdown/marks.ts
Verify: components/browser-pages/tests/markdown-review.test.ts

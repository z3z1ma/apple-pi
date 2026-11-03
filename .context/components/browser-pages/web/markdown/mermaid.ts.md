## file

The server inlines Mermaid only into a page whose document has a diagram. A sequence diagram must not keep Mermaid's default `width: 100%`: inside a centred box that becomes about 300px of unreadable text. A diagram that does not parse shows Mermaid's error in its place; the others still draw.
Why: shipping Mermaid on every page is unused weight, and the default sequence width makes a valid diagram unreadable.
Coupled: components/browser-pages/src/code-review.ts, components/browser-pages/web/pages.tsx
Verify: components/browser-pages/tests/code-review.test.ts

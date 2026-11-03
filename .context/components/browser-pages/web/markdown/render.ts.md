## file

Document content is untrusted and must never run script because the page holds the session token. URLs are checked after decoding entities and escapes; raw HTML is displayed as escaped text. Images load from the web only; local image paths are unserved and render as their alt text. Every code fence and highlighted line escapes text.
Why: a document with `<script>` or `javascript:` URLs would otherwise execute inside the review page and read its `/ask` token.
Coupled: components/browser-pages/src/markdown-review.ts
Verify: components/browser-pages/tests/markdown-review.test.ts

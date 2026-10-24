## file

Every page entry (`web/*.tsx`) imports this sheet first, then its page sheets. Vite orders CSS by import order, so a shared rule loaded later wins over a page rule of equal specificity.
Why: when this sheet came after `markdown/styles.css` through a module import, its `.app` grid overrode `.md-app`, the Markdown page collapsed to 300px, and Mermaid disappeared.

Page sheets load together with this sheet (the code review, ledger, and explain pages also load `markdown/styles.css`), so its broad selectors style their markup too. Prefix page-specific classes (the ledger page uses `lt-`) and scope layout selectors to direct children (`.graph > svg`).
Why: a ledger `.file` took the code review's `.file` styles, `.ov-intent` inherited a 760px cap, and `.graph svg` caught the icon SVGs inside graph cards.

Coupled: components/browser-pages/web/code-review.tsx, components/browser-pages/web/markdown-review.tsx, components/browser-pages/web/ledger-review.tsx, components/browser-pages/web/explain-change.tsx, components/browser-pages/web/markdown/styles.css, components/browser-pages/web/ledger/styles.css, components/browser-pages/web/explain/styles.css

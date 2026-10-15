# PROTOTYPE: Markdown review page, round 2 (`review_markdown`)

Throwaway. Round 2 of design pass 1. Round 1 ([markdown-review](../markdown-review/README.md)) was rejected for putting agent curation before the document.

## Run

```bash
open .ledger/202610151241-browser-review-surfaces/prototypes/markdown-review-v2/index.html
```

It loads `marked` and `mermaid` from jsDelivr, so it needs the network; the production page will bundle them. The bar shows the Markdown source and the result JSON.

## The design

- **The document is the page.** Real Markdown, parsed and rendered on a paper column: headings, lists, task lists, tables, links, GitHub alerts (`> [!WARNING]`), code fences with highlighting, and Mermaid diagrams drawn in the page's colours. An outline on the left follows the scroll and counts annotations per section.
- **Annotate by selecting.** Drag over any text, across blocks if needed, and a toolbar appears above it:
  - **Comment** is the main action; you can also just start typing.
  - Then small icons: 👍 Looks good, ❓ Clarify this, strike for deletion, ✏️ suggest a rewrite (shown as a tracked change), and ✦ ask the agent.
  - The text stays highlighted. Click a highlight to read or remove its annotation.
- **Secondary paths, on hover beside a block:** comment on the whole block (useful for a diagram), or edit the block's Markdown. An edit is not written to the file; it comes back to the agent as a before-and-after, and you can show its diff or revert it.
- **One optional line from the agent** above the document, which you can hide. Nothing else is curated by the agent.
- **Annotations** (top bar) opens a list in document order; clicking one scrolls to it and flashes it. **Overall comment** covers the whole document.
- **Finish review**: approve, approve with notes, or request changes. The result carries each annotation with its type, quote, source lines, comment, replacement, or label, plus the block edits.

## Checked

Driven in system Chrome with Playwright: Mermaid renders, type-to-comment, a selection across a paragraph, a heading, and a paragraph (one annotation, three source lines), suggest, delete, 👍, a block edit with its diff, and Finish review. The result JSON was read back. There were no page errors.

## Verdict

Pending operator review.

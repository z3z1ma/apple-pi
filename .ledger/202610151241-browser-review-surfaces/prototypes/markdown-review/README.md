# PROTOTYPE: Markdown review page (`review_markdown`)

Throwaway. Design pass 1 of 3 for the pages after code review. It answers: **what should reviewing one Markdown document look like?**

## Run

```bash
open .ledger/202610151241-browser-review-surfaces/prototypes/markdown-review/index.html
```

One file, no network. The black bar switches the two layouts (`?variant=A|B`), the theme, and shows the agent input, the result JSON, and the keys. State is in memory.

## The scenario

The agent revised a spec after an earlier review and asks for sign-off before writing tickets. The page shows the rendered document with the agent's framing on top ("From the agent": why, what it needs, the two sections to read first), the changes since the version you last reviewed, two agent notes pinned to passages, one judgment call, and one open question.

## Both layouts share

- Select any text to get **Comment** or **Ask**; the comment is pinned to that passage, which stays highlighted. The `+` beside a block comments on the whole block.
- **Changes** (`V`) shows what changed since the last reviewed version: changed words struck and inserted, new blocks marked "New", removed blocks struck out. `N`/`⇧N` jump between changes.
- Sections can be marked read (button or `↵` after `J`/`K`), and the top bar counts them.
- Open questions are counted in the top bar; `Q` opens and scrolls to the next one.
- **Finish review**: sign off, sign off with notes, or request changes.

## How the layouts differ

| Key | Name | Where comments, notes, and decisions sit | Navigation |
| --- | --- | --- | --- |
| A | Inline | Under the block they belong to, in the reading column, like the code review page | Outline rail on the left, with read state, changes, open questions, and comment counts per section |
| B | Margin | In a margin column beside the block, at the same height | A slim bar of section ticks on the left edge |

## Verdict (2026-10-15)

Rejected. The page put the agent's curation first (framing card, notes, decisions, section read-tracking, a changes view) and the document second; it felt hand-curated and oddly structured. The operator wants something close to Plannotator in our design system: render the Markdown well (outline, code fences, Mermaid), and give feedback by selecting text and annotating it from a toolbar above the selection. Editing a block, with the diff returned as feedback rather than written to the file, is welcome as a secondary path. Round 2: [markdown-review-v2](../markdown-review-v2/README.md).

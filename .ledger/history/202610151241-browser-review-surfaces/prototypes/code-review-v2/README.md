# PROTOTYPE: code review page, round 2

Throwaway. It answers one question: **does one design that combines [round 1](../code-review/README.md)'s Cockpit (B) and Triage (C) read well and scale to a large change?**

## Run

```bash
open .ledger/202610151241-browser-review-surfaces/prototypes/code-review-v2/index.html
```

One file, no network. The black bar switches between a **small change** (round 1's retry change) and a **large change** (generated: 12 chapters, 72 files, 91 hunks), and between light and dark. Press `?` for every shortcut. State is in memory.

## How round 1 feedback maps to this design

| Feedback | Response |
| --- | --- |
| Cockpit stepping is right; extend it | `J`/`K` hunk, `[`/`]` chapter, `↵` looks good (marks seen, collapses, moves to the next unseen hunk), `R` chapter done, `Space`/`D`/`U` scroll, `X`/`⇧X` collapse, `C` comment, `A` ask, `B` brief, `N` notes, `L` lens, `O` overview. |
| Right rail is cramped; the eye does not go right | No right rail. The brief opens each chapter at full width, above the code, and collapses to one line (`B`). |
| Keep C's two-minute focus, change map, changes by attention | They form the overview page (`00`), which opens first. "Changes by attention" is the board of cards on that page. |
| Scale to large diffs | Collapsible files and hunks with sticky headers; seen hunks collapse; long and generated hunks fold. **Repeated changes** (one change applied in many places) show one example and a list of the other places. A token comparison opens and flags any place that is more than a rename of the example (it is a hint, not proof). The map has one row per directory. The board and the attention lens count a repeated change once. |
| Agent notes take vertical space | Notes show as one line by default; `N` shows them in full. |
| Decisions are secondary and need code context | Each decision sits as one line at its place in the code and opens on click. The overview lists them compactly, with a link to the code. |
| Ask about this | Line-number click opens the composer with **Comment** or **Ask the agent**. The answer appears inline (simulated) and can become a comment. |

Two lenses in the left rail: **Story** (chapters in the agent's order, each with a strip of its hunks) and **Attention** (Read closely, Worth a look, Skim; `J`/`K` step one unit at a time, where a unit is one hunk or one whole repeated change).

## What to try on the large change

- Chapter 04: 14 repositories get the same change; one (`taxs.ts`) still reads `this.db`. It is flagged and opened.
- Chapter 05: one webhook (`payment.ts`) adds an audit call that the agent did not mention.
- Chapter 06: a 240-line generated file, folded.
- Chapter 09: the refunds flag defaults to `true` while the others default to `false`. Only one token differs, and it is flagged: keywords, literals, numbers, and operators never count as a rename.
- "Not in the story": a stray `console.log` the agent did not place.
- Switch to the Attention lens (`L`) and step with `J`/`↵`.

## Verdict

Approved by the operator on 2026-10-15 without changes. This design is the target for the production code review page.

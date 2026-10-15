# PROTOTYPE: code review page

Throwaway. It answers one question: **what should the code review page look like?**

## Run

```bash
open .ledger/202610151241-browser-review-surfaces/prototypes/code-review/index.html
```

One self-contained file, no network, no build. Switch variants with the floating bar, the `←`/`→` keys, or `?variant=A|B|C`. Add `&theme=dark` for dark mode. All state is in memory; reload to reset.

## Variants

All three share one fake change (retry with backoff in an HTTP client), the same agent payload, the same diff renderer, and the same comment, decision, and verdict blocks. They disagree about structure.

| Key | Name | Primary structure | Primary affordance |
| --- | --- | --- | --- |
| A | Essay | One long literate document: chapters in the agent's order, prose before the diffs, verdict at the end | Read top to bottom; table of contents with progress |
| B | Cockpit | Three panes: chapter list, one chapter's diffs, the agent's briefing | Step chapter by chapter (`J`/`K`, `R` to mark reviewed) |
| C | Triage | Change map, decisions to confirm, then every hunk sorted by attention | Open a hunk in a side sheet and clear it (`↵` "Looks good") |

## What to try

- Click a line number to comment; shift-click another to extend the range. Pick a kind (change, question, concern, nit, praise).
- Reply to an agent note (violet).
- Answer the judgment call and the open question.
- Look at "Not in the story" / "Not explained by the agent": a formatter change the agent did not place.
- **Agent input** shows the tool call input: structure and prose only, hunks by id.
- **Result** shows the JSON the tool would return. Nothing is sent.

## Verdict (2026-10-15)

No single winner; round 2 threads B and C.

- **B (Cockpit)** is the base: keyboard stepping is right, and it should grow (scroll shortcuts and more). The right rail feels cramped, and the eye does not go right for the brief, which frames the chapter.
- **C (Triage)**: keep "if you only have two minutes", the change map, and changes by attention. Decisions in one place are useful but lose code context.
- **A (Essay)**: dropped.
- **Across B and C**: scale to large diffs is unproven. Files and hunks need collapse and ergonomic movement through big chapters. Agent notes take too much vertical space and should collapse. Asking for input at review time is secondary; it suggests the input was not asked for earlier.

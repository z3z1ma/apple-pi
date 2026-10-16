# Ledger task review, round 1

Prototype of `review_ledger_task`: one tool call opens a whole ledger task bundle in the browser, so the user can review the spec or plan, the tickets, and their order before the agent continues, and sign off. Open `index.html` in a browser (it loads `marked` from jsDelivr). Two real closed bundles are embedded: `branch-search-challenger-benchmark` (four tickets, two roots that merge, 61 evidence files) and `monty-pi-exec` (plan and six tickets). The bar at the bottom switches the bundle, the moment of the review (tickets just written, or mid-flight), and a broken ticket graph.

## The design

- **The reader is `review_markdown`.** Every Markdown file in the bundle gets the same paper column, selection toolbar, whole-block comments and rewrites, ask the agent, and highlights. Nothing new to learn.
- **The left rail is the bundle.** Overview, `task.md`, the spec or plan, `tickets/` (number, title, criteria done, status dot), `retrospective.md`, then evidence folders, collapsed with file counts. The open document's sections nest under it, with scroll-spy, so the tree replaces the outline.
- **The overview leads with the shape of the work:** the task's Intent, then the ticket graph. Columns follow dependency depth; arrows run from blocker to blocked. Tickets that can start now carry a blue ring and are listed under the graph. Hover a ticket to light what it waits on and what waits on it; click it to open it.
- **Graph checks** come from the `to-tickets` rules: a blocker that is not in the bundle, a blocker numbered after its dependent, a cycle, no ticket that can start. They show above the graph, and cycle and out-of-order edges turn red; they warn, they do not block.
- **A ticket opens with its neighbourhood:** blocked by → this ticket → unblocks, each a link.
- **Evidence files** (JSON, logs) open in a line-numbered view and take annotations like any document. The live page reads them from disk only when opened, so a 3 MB, 100-file bundle stays fast. The saved page keeps the Markdown and every evidence file the reviewer opened.
- **Finish review** counts annotations per file and lists the documents not yet opened, as the code review lists unseen hunks.
- **Keys:** `G` overview, `[` `]` previous / next document (task, spec or plan, tickets in order, retrospective), `J` `K` sections, `?` keys, `⌘↵` finish.

## Tool contract (proposed)

```json
{ "task": "202610040726-branch-search-challenger-benchmark", "note": "I split the benchmark into four tickets; check the graph before I start 01." }
```

`task` takes the id, `.ledger/<id>`, or a path inside it. The server reads the bundle; the agent curates nothing. The result: the verdict, the overall comment, each annotation with `file:line` and its quote, each rewritten block as before and after, and which documents were opened.

## Questions for the verdict

1. **Opened ticks.** The tree ticks files you opened, and Finish lists the ones you did not. Keep both, keep only the Finish list, or drop them?
2. **Landing.** The page opens on the overview. Should a bundle without tickets open on `task.md` instead?
3. **History.** Newer bundles carry `history.json` (the session and commit pointers the ledger keeps); these two do not. Hide it, or list it with the evidence files?

## Verdict (operator, 2026-10-15)

Approved as shown. Overflow fixed after the verdict: long code in table cells now breaks (in the shared Markdown reader too, where a table still too wide scrolls inside its block), and the overview's document cards wrap or clip their titles and paths. Questions 1 and 2 stand as shown (opened ticks and the not-opened list; the page opens on the overview). Question 3 was not answered: `history.json` lists with the evidence files, which needs no special case.

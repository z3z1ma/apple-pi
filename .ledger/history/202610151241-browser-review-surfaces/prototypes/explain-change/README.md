# Explain change, round 1

Prototype of `explain_change`: a page that helps the user understand a change, after Geoffrey Litt's ["Understanding is the new bottleneck"](https://www.geoffreylitt.com/2026/07/02/understanding-is-the-new-bottleneck) and the `explain-diff-html` skill (installed in `~/.agents/skills/explain-diff-html/`), which has the agent hand-write a free-form HTML explainer. Open `index.html` in a browser (it loads `marked` and `mermaid` from jsDelivr). The example explains commit `72c7ad3` (`review_ledger_task`); every code excerpt and the list of changed files come from git.

## The design

- **One long page to read, not to review.** A reading column, contents in the left rail with scroll-spy, a reading-progress line under the top bar, `J`/`K` between parts. The top bar names the change (ref, files, lines) and keeps the quiz score in view.
- **The skill's four parts, in its order:** an "In one minute" summary first; **Background** (what was there before, with a collapsed **primer** for a reader new to the area); **Intuition** (the idea before the code: plain prose, callouts, diagrams, and interactive figures); **Walkthrough** (a literate diff: numbered steps in the order the data flows, prose around real code); **Quiz**.
- **Real code only.** A step names code as `file:lines`; the page shows those lines from git with diff marks (a new file shows plain, highlighted code). The agent writes the story, not the code.
- **Nothing hidden.** "Also changed" lists every file the walkthrough did not show, grouped (code not covered, tests, styles, built pages, docs), with line counts. The hero says how many files the walkthrough covers.
- **Figures** are agent-written HTML in a sandboxed frame: no access to the page, drawn in the page's colours, sized to their content. Figure 1 lets you edit `Blocked by` lines and watch which tickets can start and the graph checks follow. **Diagrams** are Mermaid.
- **Quiz:** multiple choice with instant feedback and an explanation for each answer; `A`–`D` answer the question in view. The score shows in the top bar and the contents; at 5/5 the page says the change is understood, otherwise "Try again" clears the misses.
- **Print:** a print stylesheet drops the chrome, so the page prints as a clean paper to read away from the screen.

## Tool contract (proposed)

The agent writes Markdown sections; three fences add the rest:

````json
{
  "title": "How review_ledger_task turns a bundle into a reviewable graph",
  "base": "main",
  "summary": "`review_ledger_task` opens a whole ledger task in the browser. …",
  "primer": "A **ledger task** is a folder, `.ledger/<id>/`, …",
  "background": "Two pages already shared one runtime. …",
  "intuition": "Think of the bundle as a small website with one map. …\n\n```figure Edit a ticket's Blocked by line and watch the checks follow.\n<div class=\"fig\">…</div><script>…</script>\n```",
  "steps": [
    { "title": "Reading ticket numbers out of prose", "body": "Two patterns split the problem. …\n\n```code components/browser-pages/src/tickets.ts:3-10\n```" }
  ],
  "quiz": [
    { "question": "Ticket 03's only blocker is 07, which is not in the bundle. How does the page show 03?", "options": ["Ready", "Blocked, with a graph problem", "Done", "Left out"], "answer": 1, "why": "A missing blocker cannot be known to be done …" }
  ]
}
````

- ```` ```code path:41-53 ```` takes no body: the server fills in the lines, from the working tree against `base` as `review_code` does.
- ```` ```figure Caption ```` holds self-contained HTML; the page runs it sandboxed. The build will also block the figure's network access; the prototype does not yet.
- ```` ```mermaid ```` draws a diagram; `> [!NOTE]` and the other GitHub alerts are callouts.

Per the settled decision in [task.md](../../task.md) (the understanding page returns at once), the tool returns at once with the saved page's path and opens it; nothing comes back to the agent. The page is the saved file itself, so it needs no server.

## Questions for the verdict

1. **Ask the agent.** The review pages let the reader ask the agent about a passage. Here that needs a page server that stays up after the tool returns. Add it, or keep the explanation a static packet?
2. **Quiz length.** The skill fixes five questions. Keep five, or let the agent choose how many?
3. **Range.** `base` works as in `review_code` (the working tree against a ref), which covers uncommitted work and branches. Should one also be able to explain a single past commit, as this prototype does?

After the verdict, `explain_change` is built on the shared page runtime, as the other three pages were.

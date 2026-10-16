Status: in-progress
Created: 2026-10-15
Updated: 2026-10-15

# Agent-structured browser review and understanding surfaces

## Intent

With one tool call, the root agent opens a local, ephemeral browser page built for one purpose. The agent shapes the content from its own context. Review pages return the human's verdict and anchored annotations to the model as the tool result. Beauty, simplicity, ergonomics, and utility are the product, not polish added later.

Four pages:

| Page | Specific affordances | Returns |
| --- | --- | --- |
| Code review | Diff viewer, agent-authored groups, explanations and caveats | Verdict + annotations |
| Markdown review | Clean reading view of one document | Verdict + annotations |
| Ledger task review | Multi-document view, ticket DAG from `Blocked by:`, spec, file tree, sign-off | Verdict + per-file annotations |
| Understanding | Background, intuition, literate walkthrough with real code, quiz (after Geoffrey Litt, ["Understanding is the new bottleneck"](https://www.geoffreylitt.com/2026/07/02/understanding-is-the-new-bottleneck)) | Nothing |

Reference: [Plannotator](https://github.com/backnotprop/plannotator). It already has Guided Review (ADR 006): a separately spawned agent job chapters a diff, and the server enforces that each changed file appears exactly once. Its in-session `plannotator` tool takes no structure from the calling agent, and agent-authored guides are read-only exports. The difference here: the agent that did the work authors the structure in the tool call, and the structured page stays fully annotatable.

## Settled decisions

- **One substrate, four layouts.** Shared session runtime (127.0.0.1 server with token, browser open, result return, cleanup on submit/abort/shutdown), shared content blocks, shared annotation/verdict model. Markdown review is a one-document case of ledger review.
- **Blocking review tools.** Code, Markdown, and ledger review tool calls wait for the human; the tool result is the feedback. The understanding page returns at once.
- **Frontend: React + Vite, single-file build, committed,** per [frontend-stack.md](frontend-stack.md). Approved 2026-10-15; the operator allows any packages the work needs.
- **Model authorship through blocks:** prose, diff hunk, code excerpt, callout, diagram, quiz, sandboxed HTML figure. No freeform whole-page HTML.
- **Model curates, cannot hide or invent code.** Code and diffs are referenced by file and range and read from git/disk by the server; hunks the model does not place appear in an "Unplaced" lane.
- **Rendered artifacts are saved** as one self-contained HTML file (app, content, and submitted result inline) that reopens offline. The agent can attach it to PRs, Confluence pages, and Jira tickets.
- **In-page "ask about this".** The human selects code or text and asks; a side conversation with the main agent's context answers inline, as `/btw` does, because the main agent is blocked on the review.
- **Hunk references are file + line range in the call.** Each chapter entry is JSON such as `{"file": "src/http/client.ts", "lines": "41-53"}` (new-side lines; omit `lines` for the whole file). The server maps it to every git hunk it overlaps; unclaimed hunks go to "Not in the story". One call, no hunk ids. Chosen over a two-call id flow after a plain explanation, 2026-10-15.
- **One tool per page** (`review_code`, `review_markdown`, `review_ledger_task`, `explain_change`) over one shared runtime. Decided 2026-10-15.
- **In-page ask ships in the second slice.** The first slice is runtime, `review_code`, the page, the result, and the saved page. Decided 2026-10-15.
- **Build directly:** implement the first slice now and record decisions here as they are made. Decided 2026-10-15.
- **Saved pages live in** `~/.pi/agent/artifacts/<project>/<date>-<slug>.html`; the agent copies or attaches a file where it is needed. Approved 2026-10-15.
- **Code review design: the [round 2 prototype](prototypes/code-review-v2/README.md),** approved 2026-10-15 without changes.
- **Ledger task review design: the [round 1 prototype](prototypes/ledger-task-review/README.md),** approved 2026-10-15; overflow fixed after the verdict.
- **Code review direction (prototype round 1 verdict).** Build on B (Cockpit) keyboard stepping; bring in C (Triage)'s "two minutes" focus, change map, and changes-by-attention view. Move the brief out of the right rail into the reading line. Make files, hunks, and agent notes collapsible. Decisions are secondary to review and need code context. Every view must scale to large diffs. A (Essay) is dropped.
- Root session only; local macOS (`open <url>`); greenfield, no compatibility layers.

## Open questions


## Draft acceptance criteria

- Each page opens from one tool call in the root session and closes cleanly on submit, abort, and session shutdown; the server binds 127.0.0.1 and rejects requests without the session token.
- Code review: every changed hunk appears exactly once, in an agent group or the Unplaced lane; all displayed code comes from git or disk.
- Review results preserve anchors (file + line range, or quoted passage), annotation kind, text, and an overall verdict.
- Ledger review renders the ticket DAG from `Blocked by:`, the spec, and the bundle file tree, and accepts annotations on any file.
- The understanding page renders background, intuition, a walkthrough with real code excerpts, figures, and an interactive quiz.
- A saved artifact is one HTML file that reopens offline and shows the content and the submitted result.
- Every page stays navigable and legible on a large change (tens of files, hundreds of hunks).
- The package-load test, typecheck, lint, tests, and `pack:check` cover the new extension and built assets.

## Current State

In progress. Built and committed: `review_code` (slices 1–2), `review_markdown` (slice 3), and `review_ledger_task` (slice 4). Next is design pass 3, `explain_change`.

- Design: code review [round 2](prototypes/code-review-v2/README.md), Markdown review [round 2](prototypes/markdown-review-v2/README.md), and ledger task review [round 1](prototypes/ledger-task-review/README.md) are approved. Stack: [frontend-stack.md](frontend-stack.md).
- Code: `components/browser-pages/`: `src/` servers, tools, ask fork, and `tickets.ts` (ticket parsing and graph checks, shared with the page); `web/` one React app per kind, with one document reader in `web/markdown/` that the Markdown and ledger pages share; committed `dist/<kind>.html` and `dist/mermaid.min.js`. Contract: `docs/browser-pages.md`.
- Slice 4: `review_ledger_task` reads a bundle by id or path (live or history): documents in reading order, tickets from `Blocked by:` (known ids anywhere, unknown ids only where they read as references; a self-reference is a cycle; a missing blocker blocks), evidence files listed and served on demand through `GET /file` from the bundle's own list, kept in the saved page once opened. Results carry `file`, and the model gets repository paths with lines and the documents not opened.
- Checks: browser-pages tests (67), including tickets, ledger build, evidence serving, result validation, model text, and the tool end to end; manual drive in Chrome on a real closed bundle ([checks](checks/README.md)): graph, hover, ticket strip, annotation, ask, evidence highlight, `[`/`]`, grouped panel, finish with unopened list, saved page with evidence.
- Not yet checked: asking with a real model in a live session; very large documents or bundles; a graph with more than about 15 tickets (it scrolls sideways).

Next:

1. Operator tries `review_markdown` and `review_ledger_task` on real work (dogfood on this task: approved without annotations; it listed the five prototype READMEs as not opened).
2. Design pass 3: `explain_change`. [Round 1](prototypes/explain-change/README.md) answered 2026-10-16: add a Socratic chat sidebar that can pop out, keep five quiz questions but teach the agent to write good ones, and explain any commit or range in history. [Round 2](prototypes/explain-change-v2/README.md) adds those and awaits the operator's verdict; then build.

## Outcome

Pending.

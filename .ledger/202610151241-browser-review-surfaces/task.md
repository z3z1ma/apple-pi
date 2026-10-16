Status: in-progress
Created: 2026-10-15
Updated: 2026-10-16

# Agent-structured browser review and understanding surfaces

## Intent

With one tool call, the root agent opens a local, ephemeral browser page built for one purpose. The agent shapes the content from its own context. Review pages return the human's verdict and anchored annotations to the model as the tool result. Beauty, simplicity, ergonomics, and utility are the product, not polish added later.

Four pages:

| Page | Specific affordances | Returns |
| --- | --- | --- |
| Code review | Diff viewer, agent-authored groups, explanations and caveats | Verdict + annotations |
| Markdown review | Clean reading view of one document | Verdict + annotations |
| Ledger task review | Multi-document view, ticket DAG from `Blocked by:`, spec, file tree, sign-off | Verdict + per-file annotations |
| Understanding | Background, intuition, literate walkthrough with real code, quiz (after Geoffrey Litt, ["Understanding is the new bottleneck"](https://www.geoffreylitt.com/2026/07/02/understanding-is-the-new-bottleneck)) | A note on what the reader missed and asked, on the agent's next turn |

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
- **Explain change design: the [round 2 prototype](prototypes/explain-change-v2/README.md),** approved 2026-10-16. The Socratic sidebar slides out from the edge (no separate window). `head` explains any commit or range. Exactly five quiz questions, checked by the server and taught by the tool's guidelines. A short note on what the reader found hard goes back to the agent.
- **Pages degrade gracefully.** A page that cannot reach a live page server with the agent behind it (a saved copy, a shared attachment, a closed session) hides every feature that needs the agent and reads as a normal page. Decided 2026-10-16.
- **The saved explanation is clean and shareable:** written when the tool runs, without the reader's quiz answers or conversation. Confirmed by the operator 2026-10-16.
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

Done. All four pages are built: `review_code`, `review_markdown`, `review_ledger_task`, and `explain_change` (slice 5). Every page degrades gracefully, and the Socratic tutor passed its real-model check.

- Design: code review [round 2](prototypes/code-review-v2/README.md), Markdown review [round 2](prototypes/markdown-review-v2/README.md), ledger task review [round 1](prototypes/ledger-task-review/README.md), and explain change [round 2](prototypes/explain-change-v2/README.md) are approved. Stack: [frontend-stack.md](frontend-stack.md).
- Code: `components/browser-pages/`: `src/` servers, tools, the read-only fork (`askFork`), `tickets.ts`, and `explain-change.ts`; `web/` one React app per kind, the shared document reader in `web/markdown/`, the explanation in `web/explain/`, and `web/connected.ts`; committed `dist/<kind>.html` and `dist/mermaid.min.js`. Contract: `docs/browser-pages.md`.
- Slice 5: `explain_change` reads any change (`base`, and `head` for history, merge-base like a pull request), turns `code path:FROM-TO` fences into real highlighted lines with removed lines in place (deleted files from their old lines), keeps figures sandboxed with network blocked, and checks the five-question quiz. It saves a clean shareable copy, opens the live page, and returns at once. The live page server takes tutor turns (a Socratic or direct frame for a read-only fork) and a note on what the reader missed and asked, delivered with the agent's next turn.
- Graceful degradation: `/health` answers whether the agent can answer (`ask: !!liveSession`). Pages check it on open, on focus, and after a failed request. Saved copies show no agent features; a live review whose session ends turns read-only with one note; an explanation keeps everything but the tutor.
- Checks: browser-pages tests (78), including the explanation's ranges, excerpts, deletions, figures, quiz, tutor prompts, note, and the tool end to end. Chrome drives on real data for all four pages: the explanation's saved copy (no agent features), the live page (sidebar, citations, step checks, selection, talk-it-through, note on leaving), the session ending (controls disappear, quiz works), the dark-mode figure, and the review pages after the readOnly change (Markdown, ledger, code review, and a review page losing its session).
- Real-model check (2026-10-16): `explain_change` on `8a055c3` (37 files) with the guidance to find the why and plan backward; every code reference resolved. The operator called the tutor "incredible" and scored 5 of 5; the note reached the agent's next turn.
- Not checked: very large changes (hundreds of hunks) on any page.

## Outcome

Shipped four browser pages over one runtime in `components/browser-pages/`, documented in `docs/browser-pages.md` and shown in the README with screenshots. The agent supplies structure; the server supplies every line of code from git or disk. Reviews return the verdict and anchored annotations as the tool result; `explain_change` returns at once, tutors the reader from a read-only fork, and sends a note back. Every page checks `/health` and reads as a plain page without its agent, so saved copies can be shared. Its writing guidance lives in the tool's guidelines (find the why, plan backward), and the global `explain-diff-html` skill was deleted. The tutor sidebar can be resized.

Acceptance criteria are met except one: legibility on very large changes is untested. The largest real case was 37 files.

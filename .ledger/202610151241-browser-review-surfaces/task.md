Status: planning
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
- **Saved pages live in** `~/.pi/agent/artifacts/<project>/<date>-<slug>.html`; the agent copies or attaches a file where it is needed. Approved 2026-10-15.
- **Code review design: the [round 2 prototype](prototypes/code-review-v2/README.md),** approved 2026-10-15 without changes.
- **Code review direction (prototype round 1 verdict).** Build on B (Cockpit) keyboard stepping; bring in C (Triage)'s "two minutes" focus, change map, and changes-by-attention view. Move the brief out of the right rail into the reading line. Make files, hunks, and agent notes collapsible. Decisions are secondary to review and need code context. Every view must scale to large diffs. A (Essay) is dropped.
- Root session only; local macOS (`open <url>`); greenfield, no compatibility layers.

## Open questions

- Tool surface: one tool per page or fewer tools with a page kind.
- How the agent refers to hunks in the tool call before it knows the server's hunk ids.
- Whether in-page ask ships in the first slice or the next.

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

Planning. Goal and core decisions agreed with the operator on 2026-10-15; open questions above remain.

- Step 1 artifact: [code review prototype, round 1](prototypes/code-review/README.md), three variants (Essay, Cockpit, Triage). Verdict recorded above.
- Step 2 artifact: [frontend stack](frontend-stack.md). Approved.
- Round 2 artifact: [code review prototype, round 2](prototypes/code-review-v2/README.md): the hybrid, with a large generated change and repeated-change groups. Approved.

Next steps, approved by the operator on 2026-10-15. The main agent designs and builds the UI itself; the designer teammate may later build one-shot components inside the established architecture.

1. Done: round 1 prototype (three variants) and the frontend stack proposal; both reviewed.
2. Round 2 prototype (`prototypes/code-review-v2/`): one hybrid of B and C. Cockpit stepping at hunk and chapter level with more shortcuts; an overview page with the two-minute focus, the change map, changes by attention, and a compact decision list; the brief at the top of each chapter, collapsible; collapsible files, hunks, and agent notes; decisions anchored in the code and compact; in-page ask with simulated answers; an attention lens in the rail. It ships a small dataset and a large generated one (tens of files, about a hundred hunks) to test scale.
3. Done: operator approved round 2.
4. Settle the remaining open questions, write the spec for the first vertical slice (shared runtime plus the code review page), and finish the acceptance criteria; then the task moves to `ready`.

## Outcome

Pending.

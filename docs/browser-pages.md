# Browser pages

Four tools open a page in the user's browser. Three are reviews and wait for the verdict:

- `review_code`: a code review. The agent writes the structure; the page shows the real diff from git.
- `review_markdown`: a Markdown document, rendered, for the user to annotate and sign off. See [Markdown review](#markdown-review).
- `review_ledger_task`: a whole ledger task bundle, with its ticket graph. See [Ledger task review](#ledger-task-review).

The fourth, `explain_change`, opens an explanation of a change for the user to understand, and returns at once. See [Explain change](#explain-change).

Root sessions only; a run without an attached user gets a message instead of a page. Every page degrades gracefully: see [Without the agent](#without-the-agent).

## Working directory

All four tools accept optional `cwd`: an absolute directory or a directory relative to the session's working directory. It defaults to the session's working directory. Use it to open a page for another repository or Git worktree directly from the session. [Interns](interns.md) and the [`/btw`](btw.md) session do not have browser tools.

For example, a session in `work` can explain a commit in a nested worktree with `cwd: "worktrees/DATA-16966"`, `base: "<commit>^"`, and `head: "<commit>"`. `review_code` accepts the same `cwd` to review that worktree's changes. Git refs are resolved in the selected repository, and code references use paths relative to its root, even when `cwd` selects a subdirectory. An invalid target fails rather than falling back to the session's repository.

For `review_markdown`, a relative `path` is resolved against `cwd`; an absolute `path` works independently of the session directory. For `review_ledger_task`, `cwd` selects the project whose `.ledger` holds the task. Returned file anchors use the target repository's paths. Page questions and the explanation tutor receive the page's absolute source directory and instructions to use absolute file paths, while retaining the parent session's conversation and working directory.

## Activation skills

Two model-invoked skills supplement the tools' always-present usage guidance:

- `operator-sign-off`: ask the operator to judge or sign off on a code change (`review_code`), a document (`review_markdown`), or a ledger task (`review_ledger_task`). Its body holds the fundamentals of presenting to a person (answer first, progressive disclosure, pictures with words, concrete before abstract, a cold `new-team-member` read before the page opens); one reference per type sets that type's goal and rigor. The separate `code-review` process audits code for defects and conformance.
- `explain-change`: teach a change the operator needs to understand well enough to build on, tested on a cold `new-team-member` reader before the page opens.

The tools' own guidance owns invocation mechanics; the skills own what the tools cannot enforce. They can also be invoked explicitly with `/skill:<name>`. They improve recognition; they do not enforce that a page opens on every matching turn.

## What the agent supplies

The tool call carries structure and prose, never code:

- `title`, `intent`, and optional `base`: the git ref to compare with (default `HEAD`).
- `focus`: the two-minute path, with references to the changes to read first.
- `verification`: what was run or checked, and what was not verified.
- `chapters`: the change in reasoning order. Each chapter has a `kind` (`core`, `consequence`, `support`), an `attention` level (`high`, `medium`, `low`), a Markdown `brief` (lists, tables, code fences, and `mermaid` diagrams render; the page inlines Mermaid only when the agent's prose has a diagram), optional `callouts`, and `changes`.
- Each change names a `file` and an optional new-side `lines` range such as `"41-53"`, with a one-sentence `summary`. A change repeated in several places lists them under `places` instead.
- `notes`: short notes pinned to a file and line.
- `decisions`: real judgment calls, with options and the agent's `chosen` index. Omit `chosen` to ask the reviewer.

## How the page is built

- **The diff:** the working tree (staged, unstaged, and untracked files) against the merge base of `base` and `HEAD`, which is how a pull request compares a branch with its target.
- **Code comes from git:** the server reads it, highlights it with Shiki (light and dark themes), and marks the changed words in each edited line.
- **Hunks follow the story:** each git hunk is split into runs of changed lines, and a run of added lines (a new file, for example) is also cut at every entry's range boundaries. A run belongs to the first chapter entry whose range overlaps it, and a hunk is cut wherever the owning entry changes, so one git hunk or one new file can span several chapters.
- **Nothing is hidden:** a run that no entry claims goes to "Not in the story".
- **Bad references are reported:** a reference that names no change, overlaps no changed lines, or repeats lines already placed becomes a warning. The page shows the warnings on its overview, and the tool result returns them to the agent.
- **Repeated changes:** the first place is shown in full as the example, and the other places are listed under it. A place is open and flagged when it is more than a consistent rename of the example (for example `invoice` → `tax`, taken from the file names). A changed keyword, value, number, or operator always counts as a difference. The check compares tokens; it is a hint, not proof that the code behaves the same.
- **Generated files:** lockfiles and paths marked `linguist-generated` in `.gitattributes` start collapsed and are not highlighted. Long hunks are folded.

## The page

- **Overview:** the intent, the two-minute focus, verification, a map with one row per directory and one block per hunk, changes grouped by attention, and the agent's decisions.
- **Chapters:** each one opens with the agent's brief, followed by its files and hunks. File and hunk headers stay visible while scrolling.
- **Review state:** hunks marked seen collapse. Agent notes show as one line until opened. Decisions sit as one line where they apply in the code. The top bar counts open questions; it, the overview's decision list, and `Q` take you straight to each question, opening and unfolding whatever hides it.
- **Two lenses:** Story follows the chapters. Attention steps through Read closely, Worth a look, and Skim, and counts a repeated change as one step.
- **Keyboard:**

  | Key | Action |
  | --- | --- |
  | `J`/`K` | Next or previous hunk |
  | `[`/`]` | Previous or next chapter |
  | `↵` | Mark the hunk seen and go to the next unseen one |
  | `⇧↵` | Mark every place of a repeated change seen |
  | `R` | Mark the chapter seen |
  | `X`/`⇧X` | Collapse or expand one hunk, or every hunk on the page |
  | `C` | Comment |
  | `A` | Ask the agent |
  | `B` | Brief |
  | `N` | Notes |
  | `Q` | Next open question: opens its hunk, unfolds its lines, and scrolls to it |
  | `⇧Q` | Next judgment call |
  | `L` | Switch lens |
  | `O` | Overview |
  | `Space`/`D`/`U` | Scroll |
  | `⌘↵` | Finish |
  | `?` | Show all keys |

- **Comments:** click a line number to comment on it, and shift-click another to extend the range. Each comment has a kind: change, question, concern, nit, or praise. A comment can also reply to an agent note.
- **Ask the agent:** the composer's second mode (or `A` on a hunk) asks a question about the selected lines. A read-only [fork](forked-continuations.md#page-questions) of the live conversation answers it: it shares the session's request prefix, sees the pending `review_code` call as a placeholder, can use only `read`, `grep`, `find`, and `ls`, and records its usage as "Review question". The answer appears under the lines; the agent's main task is not interrupted. An answer can become a comment, or be dismissed. A page opened from a session that cannot fork has no ask mode.

## The result

The tool blocks until the reviewer submits. The agent then receives:

- the verdict: approve, approve with notes, request changes, or closed without a verdict;
- the reviewer's summary;
- each comment with its kind, its `file:line` anchor, and the first line of the code it covers;
- each question asked in the page that was not dismissed, with the answer the fork gave;
- the answers to decisions, saying whether the reviewer kept or overrode the agent's choice;
- unanswered questions;
- how many hunks were marked seen;
- any reference warnings;
- the path of the saved page.

Aborting the tool call or ending the session closes the page server.

## Markdown review

`review_markdown` takes the `path` of a Markdown file and an optional one-sentence `note` shown above the document, such as what changed since the last review. The page renders the document first: an outline with section counts, code fences highlighted like the code review, tables, task lists, GitHub alerts, and Mermaid diagrams drawn in the page's colours.

The reviewer gives feedback on the text itself:

- **Select text** to open a toolbar above it. Type to comment straight away, or choose 👍 looks good, ❓ clarify this, mark for deletion, suggest a rewrite (shown as a tracked change), or ask the agent. A selection can span several blocks.
- **Hover a block** to comment on it as a whole, or to rewrite its Markdown source. A rewritten block shows the rewrite, with a diff and a way to revert.
- **Click a highlight** to see what it holds or remove it. Overlapping highlights show together.
- **Overall comment** in the top bar, and **Annotations** for the list of everything so far.
- **Keys:** `J`/`K` move between sections, `⌘↵` saves the open note or finishes the review, `Esc` closes, `?` lists the keys.

Questions go to a read-only fork, as in the code review. Text annotations point into the original document, so a rewritten block takes no new text annotations; comment on it as a whole instead.

The agent receives the verdict, the overall comment, each annotation with its kind, `path:line` range, and quoted text (with the replacement, label, or question and answer), and each rewritten block as before and after. The file itself never changes; the agent applies the feedback.

## Ledger task review

`review_ledger_task` takes `task`: a ledger task's id, `.ledger/<id>`, or any path inside the bundle, under `.ledger/` or `.ledger/history/`. An optional one-sentence `note` sits above the task. The server reads the whole bundle; the agent curates nothing.

- **The tree** on the left is the bundle: the overview, `task.md`, the spec or plan, other documents, `tickets/` (number, title, acceptance boxes ticked, and status), `retrospective.md`, then other folders, closed, with their file counts. The open document's sections nest under it. Files the reviewer opened carry a tick; annotation counts show on files and folders.
- **The overview** shows the task's Intent and the ticket graph. Tickets stand in columns by dependency depth, with arrows from each blocker to the tickets it blocks, read from each ticket's `**Blocked by:**` line. A ticket whose blockers are all done can start now; it carries a ring and is listed under the graph. Hover a ticket to light what it waits on and what waits on it; click it to open it.
- **Graph checks** follow the `to-tickets` rules: a blocker that is not a ticket in the bundle, a blocker numbered after the ticket it blocks, a cycle (a ticket that names itself included), and no ticket that can start. They show above the graph; edges that run backwards are red. A ticket waiting on a missing ticket counts as blocked.
- **Every Markdown document** opens in the same reader and takes the same annotations as `review_markdown`. A ticket opens with its neighbourhood: blocked by, the ticket, and what it unblocks.
- **Other files**, such as JSON records and logs, are evidence. The page lists them and reads one from disk only when the reviewer opens it, through the page server and only from the bundle's own list. It shows line numbers and takes annotations by line. A file that is not text says so.
- **Finish review** lists the documents the reviewer has not opened.
- **Keys:** `G` overview, `[` and `]` previous and next document in reading order, `J` and `K` sections, `?` keys.

The agent receives the verdict, the overall comment, each annotation with its repository path and lines (`.ledger/<id>/tickets/03-runner.md:9`, or a line of an evidence file), rewritten blocks as before and after, and the documents the reviewer did not open. The saved page keeps every evidence file the reviewer opened.

## Explain change

`explain_change` helps the user understand a change well enough to build on it, after Geoffrey Litt's ["Understanding is the new bottleneck"](https://www.geoffreylitt.com/2026/07/02/understanding-is-the-new-bottleneck). The agent writes the explanation; the page supplies the real code.

- **The change.** Without `head`, the working tree compared with `base` (default `HEAD`: the uncommitted changes), as `review_code` does. With `head`, the change from where `head` meets `base` up to `head`, as a pull request shows it: `base: "X^"` with `head: "X"` explains the single commit `X`.
- **How the agent prepares.** The tool's guidance has the agent find why the change exists before it writes: the ledger task that governs it, the discussion that led to it when that happened in the same session as the explanation, the context files and docs for the rules it must keep, the wiki for its terms, and the tests for its behavior. The agent then plans backward: it chooses the few ideas the reader must leave with, writes the quiz to test them, and writes the explanation that teaches them.
- **What the agent writes**, each part as Markdown: `title`, `summary` (the change in one minute), an optional `primer` for a reader new to the area (shown closed), `background` (what was there before), `intuition` (the idea before the code), `steps` (a walkthrough, each a `title` and a `body`), and `quiz`: exactly five questions, three or four options each, one right answer by index, and a `why`. The server rejects an answer that is not one of its options.
- **Three fences** add what Markdown cannot:
  - ```` ```code path:FROM-TO ```` takes no body. The page shows those lines from git, highlighted, with removed lines put back where they were and diff marks. Lines count in the file after the change, or before it for a file the change deletes. A reference that cannot be read becomes a note in the page and a warning in the tool's result.
  - ```` ```figure Caption ```` holds self-contained HTML and script. It runs in a sandboxed frame with no network and no access to the page, in the page's colours, sized to its content.
  - ```` ```mermaid ```` draws a diagram. GitHub alerts (`> [!NOTE]`) are callouts.
- **The page** reads like a document: contents with scroll-spy in the left rail, the "In one minute" summary, Background, Intuition, the numbered Walkthrough, **Also changed** (every changed file the walkthrough does not show, grouped, so nothing changes without mention), and the Quiz, with instant feedback and the score in the top bar. It prints as a clean paper. Keys: `J`/`K` parts, `Q` quiz, `A`–`D` answer, `T` theme, `?` keys.
- **Talk it through.** While the session lives, a sidebar slides out (`/`) where the reader talks to the agent; drag its left edge to widen it. **Socratic** mode, the default, answers with one question at a time, offers hints before answers, and points to the step or question that holds the answer; **Direct** answers plainly. The reader can start from selected text (*Ask about this*, *Quiz me on this*), from *Check my understanding* after a step, or from *Talk it through* on a missed quiz question. Each reply comes from a read-only fork of the live conversation that wrote the explanation, as page questions do; its usage is recorded as "Explanation tutor".
- **What the agent hears back.** The tool returns at once with the page's address and the saved copy's path. When the reader leaves the page, a short note (quiz misses and the questions asked) waits for the agent's next turn and asks it to close a gap before the next work builds on it.
- **The saved copy is for sharing.** It is written when the tool runs, without the reader's answers or conversation: attach it to a pull request or a page, and every reader takes the quiz fresh.

## Without the agent

A page reaches the agent only through its page server. A saved or shared copy has none, and a live page loses it when its session ends. A page checks `/health` when it opens, whenever the reader comes back to it, and after any request that fails; the answer also says whether the agent can answer questions now. Whatever cannot work is hidden, and the page reads as a plain page:

- a saved or shared copy shows the content, and a saved review its result, with no review tools, no *Ask*, and no tutor;
- a live review whose session ends becomes read-only, keeps the annotations already made, and says once that the review can no longer be sent;
- an explanation without the agent keeps everything but the sidebar and its entry points; the quiz still works.

A model error while the session lives is not a lost agent, and it hides nothing: the reply says the agent could not answer and why, and the next question may work. The check does not call the model, so it costs nothing.

## Saved pages

Every submitted review is saved as one self-contained HTML file in `<agent dir>/artifacts/<repository>/<date>-<title>.html`; the agent directory defaults to `~/.pi/agent`. The file opens offline and shows the review read-only, with the verdict and comments. Attach it to a pull request, a Confluence page, or a Jira ticket.

## Security

The server listens on 127.0.0.1 on a random port. It serves the page, answers questions, and accepts a submission only for requests that carry the session token and name the loopback host. It accepts one submission, and closing the page server stops any answer still running. An explanation's page server takes no submission; it runs until the session ends.

A Markdown document is untrusted content in a page that holds the token, so it never runs script: raw HTML shows as text, links keep only relative, `http`, `https`, and `mailto` targets, images load only over `http` or `https`, and Mermaid runs in its strict security mode.

## Maintaining the page

Each kind of page is a React app in `components/browser-pages/web/`, built by Vite into one self-contained file per kind: `dist/code-review.html`, `dist/markdown-review.html`, `dist/ledger-review.html`, and `dist/explain-change.html`. The Markdown and ledger pages share one document reader in `web/markdown/`. Mermaid's own build, `dist/mermaid.min.js` (about 3.6 MB), is inlined only into a page whose documents have a diagram, so other pages, and their saved copies, stay small. Pi installs git packages without dev dependencies, so the built files are committed. After changing `web/`, run `npm run build:web`. A test fails when a committed file does not match a fresh build.

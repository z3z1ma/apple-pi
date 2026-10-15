# Browser pages

Two tools open a page in the user's browser and wait for the verdict:

- `review_code`: a code review. The agent writes the structure; the page shows the real diff from git.
- `review_markdown`: a Markdown document, rendered, for the user to annotate and sign off. See [Markdown review](#markdown-review).

Root sessions only; a run without an attached user gets a message instead of a page. The same runtime will serve the ledger task review and change explanation pages. Their tools are not built yet.

## What the agent supplies

The tool call carries structure and prose, never code:

- `title`, `intent`, and optional `base`: the git ref to compare with (default `HEAD`).
- `focus`: the two-minute path, with references to the changes to read first.
- `verification`: what was run or checked, and what was not verified.
- `chapters`: the change in reasoning order. Each chapter has a `kind` (`core`, `consequence`, `support`), an `attention` level (`high`, `medium`, `low`), a Markdown `brief`, optional `callouts`, and `changes`.
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
- **Ask the agent:** the composer's second mode (or `A` on a hunk) asks a question about the selected lines. A read-only fork of the live conversation answers it, the way `clarify` does: it shares the session's request prefix, sees the pending `review_code` call as a placeholder, can use only `read`, `grep`, `find`, and `ls`, and records its usage as "Review question". The answer appears under the lines; the agent's main task is not interrupted. An answer can become a comment, or be dismissed. A page opened from a session that cannot fork has no ask mode.

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

## Saved pages

Every submitted review is saved as one self-contained HTML file in `<agent dir>/artifacts/<repository>/<date>-<title>.html`; the agent directory defaults to `~/.pi/agent`. The file opens offline and shows the review read-only, with the verdict and comments. Attach it to a pull request, a Confluence page, or a Jira ticket.

## Security

The server listens on 127.0.0.1 on a random port. It serves the page, answers questions, and accepts a submission only for requests that carry the session token and name the loopback host. It accepts one submission, and closing the page server stops any answer still running.

A Markdown document is untrusted content in a page that holds the token, so it never runs script: raw HTML shows as text, links keep only relative, `http`, `https`, and `mailto` targets, images load only over `http` or `https`, and Mermaid runs in its strict security mode.

## Maintaining the page

Each kind of page is a React app in `components/browser-pages/web/`, built by Vite into one self-contained file per kind: `dist/code-review.html` and `dist/markdown-review.html`. Only the Markdown page bundles Mermaid, which makes it about 3.7 MB; the code review page stays near 300 KB. Pi installs git packages without dev dependencies, so the built files are committed. After changing `web/`, run `npm run build:web`. A test fails when a committed file does not match a fresh build.

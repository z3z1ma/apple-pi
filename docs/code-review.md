# Captured code review

The native review queue captures exact source and intent, divides changed behavior into focused scopes, assigns independent risk questions, checks cross-scope interactions and retains findings and coverage. It uses ordinary advisory-role peers and the existing session-state runtime, not another model engine or a custom sandbox.

The queue is available through `/reviews`, native tools and Workplace Code's **Reviews** control. Capture preview, explicit freshness checks, additional-work authorization and captured-artifact browser sign-off share the runtime-owned assessment. Registering the extension does not restart an already-running runtime; an older store reports that it needs a runtime update instead of showing an empty queue.

## Native tools

| Tool | Purpose |
| --- | --- |
| `review_code` | Capture a commit, range, branch, staged tree or working tree and admit it to the durable queue, with optional approved intent, scope and risk lenses. |
| `review_queue` | Read accessible queue counts; request an explicit limit for a detail page. |
| `read_review` | Read summaries, retained targets and source, plans, findings, coverage, attempts, changes and decisions progressively. |
| `manage_review` | Cancel, resume the same captured target, capture a fresh linked rerun, reprioritize, reassign or authorize a concrete additional question with `extend`. |
| `resolve_finding` | Record an accountable finding response against an exact digest and assessment revision. |

For example:

```json
{
  "cwd": "/projects/example",
  "target": { "kind": "branch", "base": "main", "head": "feature" },
  "intent": { "path": ".ledger/change/task.md" }
}
```

`target` is the change-selection contract shared with `sign_off_code`, `explain_change` and Pi Exec evidence helpers (see [browser pages](browser-pages.md#selecting-the-change)). A branch comparison uses its merge base; a range uses exact endpoints. A working-tree capture includes tracked changes and nonignored untracked files. A staged capture uses the index. Merge commits need an explicit parent comparison. A path filter narrows review accounting and is a visible limit, while the surrounding captured source remains available as context.

An empty captured comparison or unchanged requested path scope records `no-changes`, with its exact artifact retained and no reviewer attempts. This is neither completed inspection nor a clean-review claim, and it creates no unfinished review responsibility. Cancellation and exact replay preserve that outcome; use a fresh capture to review later changes.

An applied enqueue confirms admission, not review completion. The owner receives ordinary mail on one thread per review: when the plan is ready (scopes, passes, questions) and when the review completes, is incomplete or fails, listing confirmed findings. The mail wakes an idle owner, so the requester does not need to poll. Planned passes run in parallel, at most eight at a time; reviews themselves run one after another, and validation waits for every pass. Retain the returned request handle to recover an uncertain mutation with the same arguments. A fresh rerun captures again and receives new review work; it is not a retry of an uncertain request. Admitted jobs outlive the requesting connection.

## Review queue TUI

Open `/reviews` or press `Ctrl+W`. The single master-detail interface replaces the combined `/work` and `/tasks` panel. Tasks and Pi Exec keep their tools, transcript results and shared passive activity independently.

The framed master list shows execution state with a status icon, the current pass, owner, completed/required passes, findings, reported cost and approval. The active pane is highlighted; fixed key hints remain visible while evidence scrolls, and its heading reports the visible line range. The detail view exposes summary, retained target and source, plan, findings, question coverage, attempts and decision history. Findings lead with their allegation and location, followed by validation, owner response, cause and evidence. Completed execution uses a neutral accent rather than a clean-approval color. Freshness stays **not checked** until explicitly requested; approval matching an assessment is not a claim that the checkout still matches. Choose the `freshness` evidence view to observe the requested comparison, checkout and policy separately.

| Key | Action |
| --- | --- |
| `Ctrl+W` | Toggle the queue |
| `q` | Close the focused queue |
| `Alt+G` | Move focus between editor and queue |
| `Esc` | Return focus to the editor |
| `Tab` / `Shift+Tab` | Cycle detail views forward/backward without changing pane focus |
| `Enter` | Toggle focus between the master list and detail scrolling |
| Arrow keys | Select a review or scroll evidence |
| Page Up / Page Down | Page the queue or scroll evidence by a viewport |
| `[` / `]` | Read the previous/next queue or evidence page |
| `a` | Choose a captured source file/side, capture, cancel, resume, rerun, change priority, reassign, authorize more work, open captured sign-off or recover an uncertain request |

The list includes historical assessments, not only waiting work; its count is the number of recorded reviews. The owner is accountable for the review. After admission, the runtime automatically runs temporary role-based peers for planning, focused inspections, integration and validation; an owner does not have to pick up each queued pass manually. The Attempts view identifies the actual peers and their recorded roles/models.

Capture asks for the repository/worktree directory and comparison. Before queueing it shows resolved commits and tree identities, the target digest, scope counts, approved-intent hash and omissions. The confirmation scrolls independently of its fixed controls: `y` queues, `Esc` cancels. A too-small terminal cannot confirm. Empty comparisons stop without queueing.

Capture is Git-native. The target is snapshotted straight into the capture's private object store (the author's index and objects stay unchanged), `git pack-objects` copies only the objects the two trees reach into one pack, and `checkout-index` materializes the head tree for reviewers. On this checkout (about 5,000 files, 198 MiB) a capture took about 2.7 s, down from 23-32 s with per-file copies; materializing the checkout is the part that grows with the tree. Full verification before recovery or a decision uses Git's stat cache; its first run after capture re-hashes racily clean files once.

Preview uses temporary capture storage and removes it on success, failure or cancellation. Durable admission captures again and must match the displayed digest before any reviewer starts. This costs a second capture but avoids another draft-job store or transferring ownership of UI scratch. If source or intent changed, inspect a fresh preview rather than silently queueing different code.

Wide terminals show the queue beside evidence; narrow terminals stack them. Selection follows the review ID through live reordering, resizing and hide/reopen. Confirmations identify the affected review or capture request. The uncertain-request menu retains exact arguments in memory while this session context remains alive; context changes and reload clear that menu, not the runtime journal or admitted jobs.

## Browse captured source

Use `Tab` or `Shift+Tab` to reach **Source**, which initially lists captured files. To open a file or change the comparison side, press `a`, choose **Choose captured source**, then choose `before` or `after`. Enter a repository-relative file path, or leave it blank to list captured files. Source lines are numbered separately from the panel's wrapped display lines. With the evidence pane focused, use `[` and `]` for file/line pages and Page Up/Page Down to scroll the current page. Source loading is asynchronous and cancelled when its selection or session is replaced.

The native equivalent is:

```json
{
  "review": "review-...",
  "part": "source",
  "side": "before",
  "path": "src/handler.ts",
  "offset": 0,
  "limit": 20
}
```

Omit `path` for file inventory, and omit `limit` for counts. File offsets are zero-based line offsets. These reads use the retained Git objects, including deleted files on the before side and unchanged surrounding files. They do not substitute the live checkout or a changed materialized file copy. Symlinks return their link text without following it; binary data is identified rather than decoded into lossy text, and submodule/LFS pointers remain distinct from their referenced contents.

This view returns the requested code, not the automatic `.context` append used by the ordinary `read` tool. Inspect relevant captured context files and documentation separately. Source availability is not completed review coverage. Browsing does not establish current-checkout applicability or replace the full captured-artifact verification used by recovery and decisions.

## Evidence, decisions and recovery

Each behavior scope requires correctness inspection, applicable repository standards and captured approved intent. Missing intent remains unassessed. Declared authority and reliability risks require independent passes; other risks carry explicit questions. First inspections do not receive the author's conversation or other first reports. Later validation receives the sealed reports and challenges both allegations and completed-coverage claims.

Findings retain their originating attempt, location, triggering conditions, broken invariant, impact, cause, severity, certainty, evidence and counterevidence. Model validation and later owner responses are separate records. Rejection requires evidence; accepted risk requires evidence and scope. A claimed fix stays unverified until a response cites a completed, unchallenged verification question on another captured target. That records the responder's judgment, not automatic proof of semantic correctness. It never repairs the old snapshot.

Execution, question coverage, findings and approval remain separate. Zero findings cannot make an interrupted or incomplete review clean. A validator's challenge remains attached to the exact inspected attempt, including across failed recovery. Same-target resume re-resolves role instructions, profile candidates and pool policy before reusing work. It rechecks the planner too: a changed advisory catalog or policy produces a new plan revision and fresh inspections; unchanged inputs retain eligible planning. Each attempt must match its role's policy in the planner catalog before reuse or launch. Restoring the initial policy after an intervening change therefore cannot grant coverage to a differently recorded policy. Changes during startup or execution stop visibly while preserving raw results. This is conservative policy identity checking, not a claim of semantic equivalence or provider availability. Unfinished or challenged work gets new attempts; runtime restart does not automatically repeat paid work. Cancellation waits for guarded peer cleanup and preserves partial results and observed usage.

The runtime retains operator-only approvals bound to a settled digest and assessment revision, with explicit acknowledgment of known limits. Later finding responses and newly authorized work stale the previous approval's match. Open **captured sign-off** from the queue or Workplace Code. `sign_off_code` also accepts a `review` ID alongside its normal presentation fields. The page reads the capture's retained trees rather than the live checkout, displays its exact assessment binding, labels live freshness as not checked, and requires acknowledgment before approving an assessment with limits. Opening sign-off verifies captured code without automatically re-capturing the live repository; request freshness separately through the queue when current applicability matters. Only the human browser submission records operator approval. Its success response waits for the runtime's committed receipt; refusal or uncertain delivery stays an error, not a successful sign-off. Saved pages are historical records rather than live approval controls.

### Captured configuration and live applicability

Capture records the shipped planning, inspection and validation instructions and the advisory catalog's declared model/profile references. Read `part: "configuration"` for those values. This does not freeze ambient guidance, external resources or the whole execution environment. Each attempt retains its actual resolved role/model/thinking policy. Older captures without configuration remain readable and explicitly disclose that missing identity.

`read_review` with `part: "freshness"` returns separate `matches`, `changed` or `unavailable` observations for the requested comparison, the current checkout and review policy. Checking a committed comparison is not the same as checking the dirty checkout. Freshness compares Git identities (commits, trees and the index tree), intent bytes and the review configuration (project roles read from the live checkout) rather than recapturing, so it takes a fraction of a second; every captured comparison, region and file list derives from those identities. Results carry their observation time and errors; they are neither approval nor an atomic filesystem snapshot. Refresh to recheck applicability before relying on it.

### Additional work

A settled assessment can receive a concrete question, its reason and an evidence-based stopping condition through `manage_review` with `action: "extend"`, `revision`, `digest`, `question`, `reason` and `doneWhen`. This explicitly authorizes new model cost against the retained source, advances the assessment and replans required inspections. Earlier attempts remain history. It does not capture current edits; use a new review for those. Resume alone does not authorize additional questions.

### Workplace Code

**Reviews** switches the Code workspace between the retained editor/terminals and the review queue without saving or discarding buffers. The queue is queried on demand and has an explicit **Refresh** control, rather than joining the world snapshot or polling hidden readers. Its directory follows the repository selector. Captures show a preview before queueing, require a lasting owner's ID and bind admission to the displayed digest. The queue exposes evidence/source paging, freshness, cancellation, resume, additional work and browser sign-off. An unconfirmed mutation retains its exact request identity for retry while that view remains mounted. Closing the app does not cancel admitted reviews.

The renderer uses typed preload methods; the main process fixes the operator identity, and all mutations go through the sole runtime writer. The browser is the human approval boundary: the renderer cannot supply an approval through the management endpoint.

## Reported cost

Queue rows and summaries expose `cost.reportedDollars`, `reportedAttempts` and `totalAttempts`. The amount sums each recorded attempt's primary-turn usage once, including failed and cancelled attempts and earlier plan revisions. Reusing a result creates no new attempt or charge in this projection. No attempts means zero recorded turn cost; an attempt with no usable cost observation remains missing rather than becoming zero. Invalid observations and nonfinite totals stay unavailable. A partial amount is accompanied by its observation count.

This is retained primary-turn cost reported by the SDK, not an invoice or a full accounting of internal sessions and other unobserved activity. A running turn may not have returned its usage yet. The attempts view retains the individual observations. Displayed amounts are rounded to cents, with positive sub-cent amounts shown as `<$0.01`; the native amount retains the unrounded numeric sum.

## Procedure and authority

The [code-review skill](../skills/code-review/SKILL.md) guides scope, risk, interpretation and evidence challenge. A standing board is optional consultation rather than a prerequisite for queued review. The review reports; fixes, publication and production activation need their own authority. Pair assistance and change reflection are not substitutes for independent inspection.

These mechanisms provide provenance and recovery guarantees. They do not establish that semantic decomposition finds more real defects than a simpler independent review; that comparison remains unmeasured.

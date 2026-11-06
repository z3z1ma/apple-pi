# Captured code review

The native review queue captures exact source and intent, divides changed behavior into focused scopes, assigns independent risk questions, checks cross-scope interactions and retains findings and coverage. It uses ordinary advisory-role peers and the existing session-state runtime, not another model engine or a custom sandbox.

The queue is available through `/reviews`, native tools and the Workplace **Reviews** app. Capture preview, explicit freshness checks, additional-work authorization and captured-artifact browser sign-off share the runtime-owned assessment. Registering the extension does not restart an already-running runtime; an older store reports that it needs a runtime update instead of showing an empty queue.

## Native tools

| Tool | Purpose |
| --- | --- |
| `review_code` | Capture a commit, range, branch, staged tree or working tree and admit it to the durable queue, with optional approved intent, scope and risk lenses. |
| `review_queue` | Read accessible queue counts and running passes; request an explicit limit for a detail page; `hideAddressed` leaves out addressed reviews; `analytics: true` returns cost and yield by model, by phase and per review instead. |
| `read_review` | Read summaries, retained targets and source, plans, findings, coverage, attempts, changes, decisions, the review's mail `thread` and the running passes' `log` progressively. |
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

`target` is the change-selection contract shared with `sign_off_code` and `explain_change` (see [browser pages](browser-pages.md#selecting-the-change)). A branch comparison uses its merge base; a range uses exact endpoints. A working-tree capture includes tracked changes and nonignored untracked files. A staged capture uses the index. Merge commits need an explicit parent comparison. A path filter narrows review accounting and is a visible limit, while the surrounding captured source remains available as context.

`workers` optionally names existing people in the requester's organization by name or ID; the operator retains global authority. Admission and launch both check that authority, including after a reporting move while queued. Prefer fresh temps; choose a worker only for a change it did not build or work on. This is guidance, not a harness authorship check. Focused and integration passes consume the list in plan order, then use temps. Extra workers remain unused; retries keep the same assigned worker. Planning and duplicate linking always use fresh temps. A fresh rerun copies the list, whose names resolve to stable person IDs at admission.

A worker pass launches a new headless program peer with `pi --fork <worker transcript>` and a new identity. It never dispatches to, wakes or appends to the original worker, whether awake or at home. The fork inherits the worker's conversation, role and model rather than the pass's role/model tier; the pass's questions, captured-source integrity and planned-policy identity checks still apply. A known worker model must match the fork's observed model. Attempts retain the actual model separately and expose `reviewer: {kind: "worker", person, name}` or `{kind: "temp"}`; the ordinary attempt `person` identifies the disposable peer. Cancellation, failure and restart dispose only that peer through the existing program cleanup, leaving the original worker intact.

The fork records its own inherited-history boundary before its first bridge hello. Organizational compute counts only entries generated after that boundary; copied worker spend is already incurred, not a new review charge. Reloads retain the boundary, and a later fork records its own. Fresh temps retain their zero baseline. Review logs show only the attempt's new entries, while the reviewer still receives its inherited context. Worker attempts from an older bridge without a recorded boundary have no exposed log entries in the current reader; a missing or invalid boundary never falls back to publishing inherited history. Activation requires the current runtime/schema, and existing native reader sessions must reload to acquire that log filter. Already-recorded costs and already-running older fork bridges are not rewritten.

An empty captured comparison or unchanged requested path scope records `no-changes`, with its exact artifact retained and no reviewer attempts. This is neither completed inspection nor a clean-review claim, and it creates no unfinished review responsibility. Cancellation and exact replay preserve that outcome; use a fresh capture to review later changes.

A plan is risk-driven triage, not an inventory. The planner names a few scopes by their files or directories and spends passes where risk concentrates; one pass can combine lenses, and low-risk scopes need not get their own. The runtime maps changed regions to scopes, and the integration pass reads the whole change, so a region outside every scope is still reviewed and reported as such rather than failing the plan. Only identities, roles and requested lenses are checked; the runtime no longer requires a correctness pass per scope or separate passes per risk kind.

Every pass, including integration, runs at the same time as the others and never sees their reports; the integration pass judges how the scopes interact from the source itself. Each reviewer answers through a result tool built for its attempt: the planner may choose only supplied roles, an inspection answers each of its planned questions under that question's key (completed with evidence, incomplete with a reason, or unavailable when the evidence needs a live service, hardware, credentials or a tool this machine lacks), and the harness, not the model, fills in the artifact and pass. A malformed answer is refused inside the reviewer's turn so the model corrects it. A reported finding stands as reported (a hypothesis stays unresolved); there is no second validator per report. When two or more findings exist, one short step links duplicates across reports by their keys without re-investigating; with fewer, no model runs. Each pass checks the retained manifest and comparison before and after its turn; full integrity verification (fsck and hashing every file) runs at recovery, additional work and decisions.

A failed attempt (a provider error, a turn that ended without a valid result, or a reviewer that showed no activity for 15 minutes) is retried once. A reviewer that goes silent that long is stopped: its program is closed, which discards the reviewer with SIGTERM and, if it is still running 30 seconds later, SIGKILL. So every review settles even when a provider stream stalls or a reviewer process hangs. A pass that fails twice leaves its questions unsettled and the review incomplete, with the other passes' work kept; only a planner that fails twice fails the review. A review becomes incomplete only for an unsettled question, a pass that failed twice or requested additional work, and its reason lists each one. Unavailable evidence is reported as a limit ("Could not be checked on this machine") and does not make a review incomplete. Policy changes, lost ownership, damaged captured source and unfinished cleanup are not retried; they stop the review. The planner runs at medium thinking. Each pass checks the retained manifest and comparison before and after its turn; full integrity verification (fsck and hashing every file) runs at recovery, additional work and decisions.

An applied enqueue confirms admission, not review completion. The owner receives ordinary mail on one thread per review: when the plan is ready (scopes, passes, questions), as each pass reports findings (so work can change course before the review ends; duplicates across passes are linked only at the end), and when the review completes, is incomplete or fails, listing its findings, why it is incomplete and what could not be checked. The mail wakes an idle owner, so the requester does not need to poll.

An agent that would rather block passes `wait: true` to `review_code`, `read_review` or `manage_review` (resume, rerun, extend). The call returns once the review settles, with its summary and confirmed findings, and shows progress meanwhile; a review usually takes 10 to 30 minutes, longer behind other queued reviews. Escape stops waiting, not the review. `specs/review-wait.tla` checks that the wait always ends under runtime crashes, stalled turns and hung reviewers. Mail for that review that arrives during or after the wait is recorded in the transcript as a one-line pointer instead of the full text and starts no turn, so the outcome reaches the agent once. Anyone who can read a review can wait on it; only the owner gets mail. A fix-and-review loop composes from these: `review_code` with `wait`, fix, `resolve_finding`, then `manage_review` `rerun` (or a new `review_code` with `parent`) with `wait`, until the agent or operator judges it done. Planned passes run in parallel, at most eight at a time; reviews themselves run one after another, and duplicate linking waits for every pass. Retain the returned request handle to recover an uncertain mutation with the same arguments. A fresh rerun captures again and receives new review work; it is not a retry of an uncertain request. Admitted jobs outlive the requesting connection.

## Review queue TUI

Open `/reviews` or press `Ctrl+W`. The single master-detail interface replaces the combined `/work` and `/tasks` panel. Tasks and interns keep their tools, transcript results and shared passive activity independently.

A strip above the list counts queued, running, done and failed reviews and the reviewer passes running now out of the limit of eight. The master list has one line per review, named by what it reviewed: repository, the branch or requested comparison, then the head commit and subject (`+N more` for a range of several commits) or `uncommitted changes (N files)`; captures made before this naming show only their ref. Fixed columns on the right give elapsed time (from admission until the last attempt finished, or so far), reported cost and the result: `none confirmed`, `N confirmed`, `N of M open` once some have a response, or `N answered`. The result is a count of confirmed findings, never a pass/fail verdict; that stays your sign-off. A review is *addressed* when it completed (or had no changes, or was cancelled) and every confirmed finding has a response; `h` hides addressed reviews and shows them again. The active pane is highlighted; fixed key hints remain visible while evidence scrolls, and its heading reports the visible line range. The detail views, in Tab order, are summary (including tokens in, out and cached), findings, mail, log, retained target and source, plan, question coverage, attempts, decision history, configuration, freshness and analytics. **Mail** is the review's thread: the plan, each pass's confirmed findings and the outcome as the runtime posted them, plus comments; `a` > **Comment** adds one, and the owner is mailed it. **Log** shows the recent transcript of every running pass (tool calls, results and text), or of the last attempt when none runs. **Analytics** totals cost and yield across the queue: per review, per confirmed finding, by model (with the severities each model's passes found) and by phase. Findings lead with their allegation and location, followed by its status, owner response, cause and evidence. Completed execution uses a neutral accent rather than a clean-approval color. Freshness stays **not checked** until explicitly requested; approval matching an assessment is not a claim that the checkout still matches. Choose the `freshness` evidence view to observe the requested comparison, checkout and policy separately.

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
| `h` | Hide or show addressed reviews |
| `a` | Comment, choose a captured source file/side, capture, cancel, resume, rerun, change priority, reassign, authorize more work, open captured sign-off or recover an uncertain request |

The list includes historical assessments, not only waiting work; its count is the number of recorded reviews. The owner is accountable for the review. After admission, the runtime automatically staffs passes from the optional worker pool and temps; an owner does not have to pick up each queued pass manually. The Attempts view identifies the actual peers, reviewer kind and recorded roles/models.

Capture asks for the repository/worktree directory and comparison. Before queueing it shows resolved commits and tree identities, the target digest, scope counts, approved-intent hash and omissions. The confirmation scrolls independently of its fixed controls: `y` queues, `Esc` cancels. A too-small terminal cannot confirm. Empty comparisons stop without queueing.

Capture is Git-native. The target is snapshotted straight into the capture's private object store (the author's index and objects stay unchanged), `git pack-objects` copies only the objects the two trees reach into one pack, and `checkout-index` materializes the head tree for reviewers. On this checkout (about 5,000 files, 198 MiB) a capture took about 2.7 s, down from 23-32 s with per-file copies; materializing the checkout is the part that grows with the tree. Full verification before recovery or a decision hashes every materialized file and link against the retained head tree in-process. It does not consult the checkout's index or Git config, which reviewers' ordinary Git use can change (assume-unchanged or skip-worktree flags, stat data, `core.worktree`). These timings compare capture alone; capture plus its first full verification is the boundary comparable to the old capture, see the task benchmark.

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

Each behavior scope requires correctness inspection, applicable repository standards and captured approved intent. Missing intent remains unassessed. Declared authority and reliability risks require independent passes; other risks carry explicit questions. Temp inspections do not receive the author's conversation; worker forks retain their own history. Neither receives other passes' reports from this review.

Findings retain their originating attempt, location, triggering conditions, broken invariant, impact, cause, severity, certainty, evidence and counterevidence. A finding's status (confirmed, unresolved or duplicate) and later owner responses are separate records. Rejection requires evidence; accepted risk requires evidence and scope. A claimed fix stays unverified until a response cites a completed, unchallenged verification question on another captured target. That records the responder's judgment, not automatic proof of semantic correctness. It never repairs the old snapshot.

Execution, question coverage, findings and approval remain separate. Zero findings cannot make an interrupted or incomplete review clean. Reviews from before this change keep their validators' challenges attached to the exact inspected attempt. Same-target resume re-resolves role instructions, profile candidates and pool policy before reusing work. It rechecks the planner too: a changed advisory catalog or policy produces a new plan revision and fresh inspections; unchanged inputs retain eligible planning. Each attempt must match its role's policy in the planner catalog before reuse or launch. Restoring the initial policy after an intervening change therefore cannot grant coverage to a differently recorded policy. Changes during startup or execution stop visibly while preserving raw results. This is conservative policy identity checking, not a claim of semantic equivalence or provider availability. Unfinished work gets new attempts. After a runtime restart, a review that was queued or running resumes by itself once its reviewer cleanup finishes and its captured source verifies; if either fails, it stays interrupted with that reason and needs an explicit resume. Cancellation waits for guarded peer cleanup and preserves partial results and observed usage.

The runtime retains operator-only approvals bound to a settled digest and assessment revision, with explicit acknowledgment of known limits. Later finding responses and newly authorized work stale the previous approval's match. Open **captured sign-off** from the queue or Workplace Reviews. `sign_off_code` also accepts a `review` ID alongside its normal presentation fields. The page reads the capture's retained trees rather than the live checkout, displays its exact assessment binding, labels live freshness as not checked, and requires acknowledgment before approving an assessment with limits. Opening sign-off verifies captured code without automatically re-capturing the live repository; request freshness separately through the queue when current applicability matters. Only the human browser submission records operator approval. Its success response waits for the runtime's committed receipt; refusal or uncertain delivery stays an error, not a successful sign-off. Saved pages are historical records rather than live approval controls.

### Captured configuration and live applicability

The planner gives every pass a depth. The role is the perspective; depth is the model tier. A deep pass runs its role on the `deep` inference profile; a standard pass runs the role's own profile, except that a role whose profile is `deep` steps down to `balanced`. The planner keeps deep for the highest-risk scope because a deep pass costs several times as much (measured on OpenAI: about $4 against $0.63 per inspection pass). Tiers come from `model-profiles.json`, so the same plan runs on any provider whose profiles define `balanced` and `deep` (the OpenAI and Anthropic examples both do). A role that lists only concrete models has no tier and keeps them at either depth; a profile missing from the file falls back to the role's concrete recommendations, which are not tiered. The planner and the duplicate merge run standard.

Capture records the shipped planning, inspection and duplicate-linking instructions and the advisory catalog's declared model/profile references. Read `part: "configuration"` for those values. This does not freeze ambient guidance, external resources or the whole execution environment. Each attempt retains its actual resolved role/model/thinking policy. Older captures without configuration remain readable and explicitly disclose that missing identity.

`read_review` with `part: "freshness"` returns separate `matches`, `changed` or `unavailable` observations for the requested comparison, the current checkout and review policy. Checking a committed comparison is not the same as checking the dirty checkout. Freshness compares Git identities (commits, trees and the index tree), intent (origin and bytes), the repository identity and the review configuration (project roles read from the selected head tree, as capture does) rather than recapturing, so it takes a fraction of a second; every captured comparison, region and file list derives from those identities. Results carry their observation time and errors; they are neither approval nor an atomic filesystem snapshot. Refresh to recheck applicability before relying on it.

### Additional work

A settled assessment can receive a concrete question, its reason and an evidence-based stopping condition through `manage_review` with `action: "extend"`, `revision`, `digest`, `question`, `reason` and `doneWhen`. This explicitly authorizes new model cost against the retained source, advances the assessment and replans required inspections. Earlier attempts remain history. It does not capture current edits; use a new review for those. Resume alone does not authorize additional questions.

### Workplace Reviews

**Reviews** is its own Workplace app, beside Code and Git. It shows the same strip and **Hide addressed** filter as the TUI, a list of review cards (state, title, repository and branch, findings, elapsed or live pass progress, cost, owner) and the selected review in detail: a header with its state, owner, cost, assessment and actions, a progress line (queued, planning, inspecting with passes, merging duplicates, settled), and the evidence in tabs. The repository selector filters the queue; **All repositories** shows every review in the operator's organization. The rail badge counts reviews whose state changed since the operator last saw them; a review counts as seen when it is shown selected in the app, and **Mark seen** clears the rest. Seen states are kept on this device. Each tab is laid out for reading: summary tiles (status, findings, coverage, elapsed, cost) over the plan and details; findings with problem, trigger, cause and correction; mail as a conversation; the log as each running pass's timeline; target, plan scopes and passes, coverage questions, attempts, decisions and configuration as cards and tables; source with line numbers; and freshness as three separately judged observations. **Mail** has a comment box; **Analytics** replaces the queue with the cost and yield tables. While the app is visible the queue refreshes every two seconds, as do the Log and Mail tabs; it never reads while hidden, and **Refresh** reads at once. The badge reads only review states, every two seconds while the runtime is connected. **New review** opens a capture dialog: repository, target, owner chosen from the roster and optional intent; it shows a preview before queueing and binds admission to the displayed digest. A review started from Code's inline **Review This** opens here with **Open in Reviews**. The queue exposes evidence/source paging, freshness, cancellation, resume, additional work and browser sign-off. An unconfirmed mutation retains its exact request identity for retry while that view remains mounted. Closing the app does not cancel admitted reviews.

The renderer uses typed preload methods; the main process fixes the operator identity, and all mutations go through the sole runtime writer. The browser is the human approval boundary: the renderer cannot supply an approval through the management endpoint.

## Reported cost

Queue rows and summaries expose `cost.reportedDollars`, `reportedAttempts` and `totalAttempts`. The amount sums each recorded attempt's primary-turn usage once, including failed and cancelled attempts and earlier plan revisions. Reusing a result creates no new attempt or charge in this projection. No attempts means zero recorded turn cost; an attempt with no usable cost observation remains missing rather than becoming zero. Invalid observations and nonfinite totals stay unavailable. A partial amount is accompanied by its observation count.

This is retained primary-turn cost reported by the SDK, not an invoice or a full accounting of internal sessions and other unobserved activity. A running turn may not have returned its usage yet. The attempts view retains the individual observations. Displayed amounts are rounded to cents, with positive sub-cent amounts shown as `<$0.01`; the native amount retains the unrounded numeric sum.

## Procedure and authority

The [code-review skill](../skills/code-review/SKILL.md) guides scope, risk, interpretation and evidence challenge. A standing board is optional consultation rather than a prerequisite for queued review. The review reports; fixes, publication and production activation need their own authority. Pair assistance and change reflection are not substitutes for independent inspection.

These mechanisms provide provenance and recovery guarantees. They do not establish that semantic decomposition finds more real defects than a simpler independent review; that comparison remains unmeasured.

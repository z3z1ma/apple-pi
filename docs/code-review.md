# Captured code review

The native review queue captures exact source and intent, divides changed behavior into focused scopes, assigns independent risk questions, checks cross-scope interactions and retains findings and coverage. It uses ordinary advisory-role peers and the existing session-state runtime, not another model engine or a custom sandbox.

The queue and `/reviews`, including the TUI's pre-queue target preview, are implemented. The wider integration is still in progress: live-target/policy freshness, cost/source drill-down, additional-work decisions, captured-artifact browser sign-off, Workplace Code and a substantial terminal visual pass remain pending. Existing ad hoc `sign_off_code` is not yet connected to a recorded review ID. Registering the extension does not restart an already-running runtime; an older store reports that it is unavailable instead of showing an empty queue.

## Native tools

| Tool | Purpose |
| --- | --- |
| `review_code` | Capture a commit, range, branch, staged tree or working tree and admit it to the durable queue, with optional approved intent, scope and risk lenses. |
| `review_queue` | Read accessible queue counts; request an explicit limit for a detail page. |
| `read_review` | Read summaries, retained targets, plans, findings, coverage, attempts, changes and decisions progressively. |
| `manage_review` | Cancel, resume the same captured target, capture a fresh linked rerun, reprioritize or reassign. |
| `resolve_finding` | Record an accountable finding response against an exact digest and assessment revision. |

For example:

```json
{
  "cwd": "/projects/example",
  "target": { "kind": "branch", "base": "main", "head": "feature" },
  "intent": { "path": ".ledger/change/task.md" }
}
```

A branch comparison uses its merge base; a range uses exact endpoints. A working-tree capture includes tracked changes and nonignored untracked files. A staged capture uses the index. Merge commits need an explicit parent comparison. A path filter narrows review accounting and is a visible limit, while the surrounding captured source remains available as context.

An empty captured comparison or unchanged requested path scope records `no-changes`, with its exact artifact retained and no reviewer attempts. This is neither completed inspection nor a clean-review claim, and it creates no unfinished review responsibility. Cancellation and exact replay preserve that outcome; use a fresh capture to review later changes.

An applied enqueue confirms admission, not review completion. Retain the returned request handle to recover an uncertain mutation with the same arguments. A fresh rerun captures again and receives new review work; it is not a retry of an uncertain request. Admitted jobs outlive the requesting connection.

## Review queue TUI

Open `/reviews` or press `Ctrl+W`. The single master-detail interface replaces the combined `/work` and `/tasks` panel. Tasks and Pi Exec keep their tools, transcript results and shared passive activity independently.

The master list shows execution state, the current pass, owner, completed/required passes, findings and approval. The detail view exposes summary, retained target, plan, findings, question coverage, attempts and decision history. Live freshness is currently labeled **not checked**; approval matching an assessment is not a claim that the checkout still matches.

| Key | Action |
| --- | --- |
| `Ctrl+W` | Toggle the queue |
| `q` | Close the focused queue |
| `Alt+G` | Move focus between editor and queue |
| `Esc` | Return focus to the editor |
| `Tab` / `Enter` | Switch between queue selection and evidence scrolling |
| Arrow keys | Select a review or scroll evidence |
| Page Up / Page Down | Page the queue or scroll evidence by a viewport |
| `[` / `]` | Read the previous/next queue or evidence page |
| `v` | Choose the evidence view |
| `a` | Capture, cancel, resume, rerun, change priority, reassign or recover an uncertain request |

Capture asks for the repository/worktree directory and comparison. Before queueing it shows resolved commits and tree identities, the target digest, scope counts, approved-intent hash and omissions. The confirmation scrolls independently of its fixed controls: `y` queues, `Esc` cancels. A too-small terminal cannot confirm. Empty comparisons stop without queueing.

Preview uses temporary capture storage and removes it on success, failure or cancellation. Durable admission captures again and must match the displayed digest before any reviewer starts. This costs a second capture but avoids another draft-job store or transferring ownership of UI scratch. If source or intent changed, inspect a fresh preview rather than silently queueing different code.

Wide terminals show the queue beside evidence; narrow terminals stack them. Selection follows the review ID through live reordering, resizing and hide/reopen. Confirmations identify the affected review or capture request. The uncertain-request menu retains exact arguments in memory while this session context remains alive; context changes and reload clear that menu, not the runtime journal or admitted jobs.

## Evidence, decisions and recovery

Each behavior scope requires correctness inspection, applicable repository standards and captured approved intent. Missing intent remains unassessed. Declared authority and reliability risks require independent passes; other risks carry explicit questions. First inspections do not receive the author's conversation or other first reports. Later validation receives the sealed reports and challenges both allegations and completed-coverage claims.

Findings retain their originating attempt, location, triggering conditions, broken invariant, impact, cause, severity, certainty, evidence and counterevidence. Model validation and later owner responses are separate records. Rejection requires evidence; accepted risk requires evidence and scope. A claimed fix stays unverified until a response cites a completed, unchallenged verification question on another captured target. That records the responder's judgment, not automatic proof of semantic correctness. It never repairs the old snapshot.

Execution, question coverage, findings and approval remain separate. Zero findings cannot make an interrupted or incomplete review clean. A validator's challenge remains attached to the exact inspected attempt, including across failed recovery. Same-target resume re-resolves role instructions, profile candidates and pool policy before reusing work. It rechecks the planner too: a changed advisory catalog or policy produces a new plan revision and fresh inspections; unchanged inputs retain eligible planning. Each attempt must match its role's policy in the planner catalog before reuse or launch. Restoring the initial policy after an intervening change therefore cannot grant coverage to a differently recorded policy. Changes during startup or execution stop visibly while preserving raw results. This is conservative policy identity checking, not a claim of semantic equivalence or provider availability. Unfinished or challenged work gets new attempts; runtime restart does not automatically repeat paid work. Cancellation waits for guarded peer cleanup and preserves partial results and observed usage.

The runtime also retains operator-only approvals bound to a settled digest and assessment revision, with explicit acknowledgment of known limits. Later finding responses stale the previous approval's match. The browser integration that submits this binding is not yet available.

## Procedure and authority

The [code-review skill](../skills/code-review/SKILL.md) guides scope, risk, interpretation and evidence challenge. A standing board is optional consultation rather than a prerequisite for queued review. The review reports; fixes, publication and production activation need their own authority. Pair assistance and change reflection are not substitutes for independent inspection.

These mechanisms provide provenance and recovery guarantees. They do not establish that semantic decomposition finds more real defects than a simpler independent review; that comparison remains unmeasured.

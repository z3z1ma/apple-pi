# Implementation continuity

The approved proposal remains authoritative. These are code-level integration notes, not another approval gate.

## Landed checkpoints

- `651d2972`: exact capture, types, batch Git I/O, fixtures and packaging.
- `ecae1117`: migration34 admission jobs, interruption/resume, responsibility guards, semantic contracts and explicit-runtime program-client support. Its cleanup fix preserves the process-death guard and historical finished-task evidence.

The task remains in progress. Preserve unrelated departure/organization tests and context changes plus `.pi/LEARNINGS.md`.

## Execution checkpoint

Migration35 stores `review_attempts`. `review-jobs.ts` claims queued jobs in priority/FIFO order and sequences planner, focused passes, independent integration and finding/coverage validation. Each phase uses `runReviewAttempt` and the existing `openPeerProgram`/start/run_turn/disposal lifecycle. It is not a second agent engine.

`reviewScope` derives review ownership from the persisted program ID and rechecks the current owner/generation/plan revision/person/role. No extra `program_open` wire fields were needed. `Runtime.prepareProgramLaunch` chooses captured cwd and headless launch for those scopes; ordinary programs retain caller cwd/tmux. Review-owned startup preserves membership but skips the automatic team-context notice. First reports are absent from other inspection briefs and reach the later validator explicitly.

The attempt stores role source/policy, exact input identity, observed model/thinking at turn start, native transcript reference, raw structured turn result/usage and validated output. Cleanup must finish before attempt completion. Raw turn completion is not successful validation. Observed correlated-turn usage is not a guessed total for other internal model activity.

Restart interrupts in-flight attempts/jobs. Resume waits for old scope cleanup, verifies the same artifact and starts fresh identities for unfinished work. A completed, cleaned exact-input pass can be reused within that same job/plan. New targets still require new review work. Obsolete receipts cannot finish a replacement attempt. Additional-pass requests and explicit coverage gaps currently leave a job incomplete; their operator decision path is still open.

Tests use private state and fake peers. The SDK fixture additionally launches actual AgentSessions with organization/bridge/peer-turn installers, scripted models and read/bash tools. It observes actual provider messages, role sections, captured relative read/Git/search and the first-report/validation separation. It does not load every unrelated package extension, run a live provider or establish model quality. The ordinary-onboarding control asserts the existing channel-pointer/goal contract, not old copied-backscroll behavior.

## Reader and native checkpoint

Migration36 persists selected_attempts; migration37 records a validator's reuse block on the exact attempt so a failed retry cannot erase a prior challenge. review-read.ts owns consistent, authorized, progressive snapshots; it follows command-result handles and inventories review organizations rather than the work-only anchors helper. Challenge gaps affect counts and resume eligibility. The new tools.ts and extensions/code-review.ts provide four tested native entrypoints, including stable exact-request recovery and explicit new-target rerun. The extension was outside the package activation list at this checkpoint. Final focused cohort: 88 tests in eight files; types, scoped static/context checks and package inventory passed.

## Decision checkpoint

Migration38 adds review_decisions. review-decisions.ts owns transactional response/approval recording and the shared sign-off-limit projection. resolve_finding is the fifth SDK-tested native tool; its package registration followed in the retirement increment. Finding decisions advance the assessment revision, approvals bind it without advancing it, and readers preserve both original allegations and decision history. Fix verification names another captured target's selected, unchallenged completed question and freezes the exact attempt/validator/evidence. It does not repair or grant approval to the original source. Only operator commands can approve, with explicit acknowledgment of displayed limits. The browser still needs to present that exact snapshot and submit the same binding.

## Review TUI checkpoint

The standalone ReviewPanel and ReviewManager now mount through extensions/code-review.ts. withReviews supplies a shared snapshot wrapper; queue around-paging uses the actual selected ID and the same ordering/filter as its page. TUI pages derive from the viewport, with independent evidence scroll/page and master selection. Confirmed human actions use operator commands, while reads use the current person's scope and fresh captures assign that person lasting ownership. Unknown sends retain an exact replay handle/payload in memory only; reload/context change clears that menu, not runtime state.

Twenty-two focused tests passed in two files, including the loaded command over a real isolated runtime with a fake terminal. At that checkpoint the package activation list still excluded this extension and /work remained unchanged. An intern only mapped which old Pi Exec tests contain execution assertions; no implementation was delegated. Keep those assertions when removing panel-only tests and dependencies.

## Combined-panel retirement

The package now selects extensions/code-review.ts in place of extensions/work.ts. Tasks and Pi Exec retain execution, native results/traces, role authorization, cancellation/cleanup, saved programs and passive activity. Only active invocation memory remains in active-work.ts; settled output belongs to the native result rather than an unused panel history. The old panel modules and panel-only tests are removed; tests/pi-exec-integration.test.ts retains the real-loader runtime assertions. Native child refs include their pi. prefix even though old display labels abbreviated it. The code-review skill now guides native queue use, and always-present tool guidance distinguishes an assigned pass from initiating a new job. Registration changes new/reloaded sessions, not the running production daemon.

## Capture preview checkpoint

The TUI now chooses a directory/worktree and captures an exact temporary preview before asking to queue. It shows resolved endpoints, trees, digest, intent provenance/hash and limits. Enqueue carries expectedDigest outside ReviewRequest, so the runtime's normal durable capture must match it before becoming queued. The temporary preview is removed; there is no draft-job state or adoption of caller-owned files. The deliberate trade-off is a second full capture. Native review_code remains direct enqueue; the UI alone currently short-circuits no-change requests.

The installed Pi confirm dialog is an unbounded selector title in the editor container. Long metadata needs a viewport-scrolled confirmation with fixed controls and an owned overlay handle. The queue hides during ordinary dialogs and confirmation; its Alt+G shortcut cannot steal focus from that hidden state. Closing or resetting the queue aborts UI interaction without claiming rollback of any submitted command. Fifty focused tests in four files and Node/web types passed; actual terminal paint remains unverified.

## Policy-sensitive recovery checkpoint

The suspected recovery gap was reproduced for changes to role instructions, configured model candidates, pool selection and the advisory catalog: all four cases retained plan revision 1 instead of replacing it. Current execution resolves policy before lookup, includes it in input identity, and rechecks the selected planner on every resume. The selected planner may cross the revision increment it originally produced; unchanged planning retains its revision. A new planner advances the revision and starts fresh inspections. Catalog fingerprints conservatively include advisory source and candidate/selection policy.

Policy is checked before dispatch, after the turn and before job completion. A startup race keeps the same model eligible yet refuses dispatch, and a real SDK scripted turn retains its raw completed result while rejecting current-policy coverage after a mid-turn change. Metadata inspection leaves pool counters untouched. The final cohort passed 73 tests in five files, plus Node/web types and loader checks. This fixes execution/recovery; capture-time instruction/configured-reference identity in the artifact manifest and current-target applicability still need implementation.

## Next implementation seams

1. **Stable decisions (runtime implemented; UI pending).** Build on the shared queue/detail reader over jobs, plans and selected attempts. Separate completion, coverage, findings, missing intent, freshness and approval. Preserve original allegations, validation, rejected-with-counterevidence, accepted-risk authority/scope and unverified fixed claims. A fixed claim needs a new target's verification. Migration38 now retains these decisions; runtime remains sole writer. Approval needs a stable terminal assessment/revision and exact artifact, not in-flight progress or a live diff.
2. **Extra work and freshness.** Policy-sensitive execution/recovery is now covered above. Complete capture-time instruction/configured-reference identity and explicit source/policy applicability checks before calling a result current; execution-time policy checks alone do not establish either. Pre-queue preview and exact resolved endpoints now exist in the TUI. Complete observed cost (without inventing missing usage) and retained-source drill-down. Give the plan owner a usable response to concrete extra-pass requests and gaps. Resuming unchanged completed reports alone cannot resolve new questions. Preserve the approved reason/stopping-condition rule without arbitrary budgets or recursive spawning. Explicit rerun creates a new target/lineage; source/policy/intent changes do not inherit coverage or approval. Represent missing intent as unassessed even if a model omits that limitation. Native empty comparisons now settle as no-changes before dispatch, distinct from completed inspection; the39-test/four-file cohort, types, loader and package checks passed. Live native admission also returned no-changes with zero attempts.
3. **Native surface.** Extend the implemented `review_code`, `review_queue`, `read_review`, `manage_review` and the implemented `resolve_finding` using the existing command journal for mutations and readonly database readers for queries. Keep stable request IDs and fail clearly on an old runtime schema. Captured-artifact `sign_off_code` must bind review ID/digest/assessment revision. No live-source fallback.
4. **One queue UI.** The master-detail /reviews panel replaces /work, but the operator rejected its live visual quality. Give it a substantial visual pass with hierarchy, chrome/borders, semantic colors, status iconography, visible focus/actions and readable evidence; inspect actual terminal rendering. Enrich its shared status with the remaining capture/freshness/cost evidence while preserving independent Tasks/Pi Exec tools and passive activity. Add Workplace Code via its backend/main/preload/UI contracts and the same reader/mutations. Preserve World and the existing file/draft/terminal authority boundaries.
5. **Delivery proof.** Cover native, IPC, rendered UI, freshness and approval races, build/package relevant surfaces and update docs/boundaries/architecture/skill guidance. The operator-authorized runtime restart migrated schema33 to38 and preserved all63 people in the immediate snapshot. Reloaded native tools work; no-change admission has live evidence, and a real committed-target review is in progress. Full CLI visual quality, browser/app integration and completed live review outcomes remain unverified. Future restarts still require fresh runtime/app identity and appropriate authority.

The core slices 1-3 still have to work together. Live paid QA is now running; no comparative experiment, automatic commit enqueue or acceptance waiver has occurred. The no-change test's dormant departure must prove its stand-in exited after restart; fakeBridge supplies neither automatic reconnection nor writer exit.

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

Migration36 persists selected_attempts; migration37 records a validator's reuse block on the exact attempt so a failed retry cannot erase a prior challenge. review-read.ts owns consistent, authorized, progressive snapshots; it follows command-result handles and inventories review organizations rather than the work-only anchors helper. Challenge gaps affect counts and resume eligibility. The new tools.ts and extensions/code-review.ts provide four tested native entrypoints, including stable exact-request recovery and explicit new-target rerun. The extension is not in the package activation list until the rest of the operator-facing integration is ready. Final focused cohort: 88 tests in eight files; types, scoped static/context checks and package inventory passed.

## Decision checkpoint

Migration38 adds review_decisions. review-decisions.ts owns transactional response/approval recording and the shared sign-off-limit projection. resolve_finding is the fifth SDK-tested native tool; it is not publicly activated. Finding decisions advance the assessment revision, approvals bind it without advancing it, and readers preserve both original allegations and decision history. Fix verification names another captured target's selected, unchallenged completed question and freezes the exact attempt/validator/evidence. It does not repair or grant approval to the original source. Only operator commands can approve, with explicit acknowledgment of displayed limits. The browser still needs to present that exact snapshot and submit the same binding.

## Next implementation seams

1. **Stable decisions (runtime implemented; UI pending).** Build on the shared queue/detail reader over jobs, plans and selected attempts. Separate completion, coverage, findings, missing intent, freshness and approval. Preserve original allegations, validation, rejected-with-counterevidence, accepted-risk authority/scope and unverified fixed claims. A fixed claim needs a new target's verification. Migration38 now retains these decisions; runtime remains sole writer. Approval needs a stable terminal assessment/revision and exact artifact, not in-flight progress or a live diff.
2. **Extra work and freshness.** Give the plan owner a usable response to concrete extra-pass requests and gaps. Resuming unchanged completed reports alone cannot resolve new questions. Preserve the approved reason/stopping-condition rule without arbitrary budgets or recursive spawning. Explicit rerun creates a new target/lineage; source/policy/intent changes do not inherit coverage or approval. Represent missing intent as unassessed even if a model omits that limitation. Empty comparisons also need an explicit no-change result rather than fabricated inspection.
3. **Native surface.** Extend the implemented `review_code`, `review_queue`, `read_review`, `manage_review` and the implemented `resolve_finding` using the existing command journal for mutations and readonly database readers for queries. Keep stable request IDs and fail clearly on an old runtime schema. Captured-artifact `sign_off_code` must bind review ID/digest/assessment revision. No live-source fallback.
4. **One queue UI.** Replace `/work` with single-tab master-detail `/reviews` and useful master-list status. Preserve Tasks/Pi Exec tools and passive activity; move `ExecInvocation` away from the old `work-panel.ts` dependency before removing the panel. Add Workplace Code via its backend/main/preload/UI contracts and the same reader/mutations. Preserve World and the existing file/draft/terminal authority boundaries.
5. **Delivery proof.** Cover native, IPC, rendered UI, freshness and approval races, build/package relevant surfaces and update docs/boundaries/architecture/skill guidance. The full CLI/package environment, live provider behavior and actual activation remain unverified. Any later activation requires fresh runtime/app identity and the operator's authority; no production restart has occurred.

The core slices 1-3 still have to work together. No paid comparison, automatic commit enqueue, activation or acceptance waiver has occurred.

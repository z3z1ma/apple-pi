Status: complete
Created: 2026-10-03
Updated: 2026-10-05

# Retrospective

## What Mattered

Coding children need completion discipline where their full implementation context lives. One in-band `agent_before_settle` continuation reviews/revalidates, captures useful learnings, and produces the final handoff; primary passive forks remain separate. Pairing, reflection eligibility, and notebook ownership are independent responsibilities.

The primary owns one live notebook. Direct/nested coding children and their pairs have immediate add-only access, while the primary and its pair retain curation. Selected original child evidence is archived with qualified addresses and provenance, rather than copying whole transcripts. Acceptance survives later failure or cancellation; stale capabilities reject without affecting unrelated owners.

Real SDK/provider-request tests exposed defects that mocked boundaries or idle compaction alone missed. Independent final reviews covered both standards and specification fidelity across all four tickets. The integration review found one significant inherited-fork tracking bug, which was reproduced and corrected before closure. Final validation passed all six required checks, including 1,422 unit tests, 118 offline pair tests, package loading, packaging, and cache audit.

## Learnings

- **Use the native completion boundary.** `agent_before_settle` can append instructions and request ordinary continuation inside awaited `session.prompt()`. It can fire again, so guard once per invocation. SDK handler exceptions are swallowed; throwing from the hook is not a reliable failed-child outcome.
- **Invocation boundaries must survive compaction.** A projected message count can become invalid when history shrinks. Bound response/error/completion selection to canonical journal entries after the invocation's starting leaf. Finalize journaled reports even when `session.prompt()` rejects, carrying the rejection as ordinary failure rather than losing the report or weakening compaction safety.
- **Prove the actual compaction path.** Synthetic usage alone may leave no foldable history. Require evidence that native compaction occurred, with real projected content. Manual idle compaction does not prove automatic pre-response or overflow-recovery ordering.
- **Append snapshots before the next request.** `sendMessage(triggerTurn:false)` queues during active automatic compaction. The eventual archive can contain a packet that was absent from the first post-compaction provider context. Append through the public child journal at the successful boundary; observe that first context and stable later prefixes.
- **Retained evidence needs usable addresses.** A child entry id is not a primary-session address. Preserve original source/provenance, expose its qualified citation address in model-facing recall text, and validate archived addresses in both driver and pair-maintenance paths.
- **Test an actual stale submission.** A child waiting until aborted never reaches a scripted late-write branch. Use a fresh non-aborted pair/session call after revocation and assert tool rejection plus unchanged old/current archives. Exercise actual child disposal, not only absence of a marker.
- **Separate pair authority from root curation.** A child pair cites actual partner source labels or expanded receipt provenance, not its private transcript or receipt handles. Its additions are immediate and add-only. Primary-pair successful-attempt staging, rollback, and retention policy remain unchanged.
- **Scope fork suppression to the tracked session.** AsyncLocalStorage propagates a primary fork marker into a real coding child. Suppressing every descendant tool loses that child's own edits and failed-command evidence. Identify the session whose tools the fork reuses, retaining inherited workspace/process/cancellation scope and excluding only that session's fork work.
- **Keep offline mode explicit.** `PAIR_E2E=0` still enables the opt-in pair harness. Unset it. One reviewer accidentally selected opt-in mode, timed out before `agent_start`, and cleaned up; provider-request occurrence was unconfirmed and the attempt was excluded from proof.

## Improvements

The durable owners are the native SDK integration/regression suites and the product contracts in `docs/context.md`, `docs/subagents.md`, `docs/change-reflection.md`, and `docs/pair-programmer.md`. Tests now cover immediate primary visibility, original child recall after disposal, real stale rejection, direct/nested pair authority, first-request automatic compaction snapshots, compacted/rejected prompt report retention, and fork-relative tracking.

Concurrent work must remain separate. Unrelated timing-sensitive suites passed alone after an initial full-run failure; a concurrent ledger-history expectation passed after its implementation landed. Neither lane was changed to force this task green. Final complete checks were rerun after corrections, rather than relying on earlier launches or partial successes.

Scripted sessions establish delivered instructions and deterministic behavior, not autonomous model compliance. Prefix preservation and cache audit do not establish live-provider cache-hit performance. Some combinations rely on shared-path inspection rather than dedicated tests, including a pair addition followed by its own provider failure and customized global pair prompts. No material unresolved defect remains from the completed reviews.

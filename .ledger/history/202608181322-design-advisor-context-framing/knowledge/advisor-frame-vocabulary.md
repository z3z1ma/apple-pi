Status: active
Created: 2026-08-18
Updated: 2026-08-18

# Advisor frame vocabulary

Terms used by the framing and coalescing specs. Do not copy into product docs unless distillation says so.

- **Request.** One primary `before_agent_start` … `agent_end` cycle. The kickoff is `event.prompt`. Later user-role session entries in that cycle, classified by looking past custom entries to the previous message, are **steers**. Advisor `advisory` customs are not user steers.
- **Recent user messages.** Seed-only collection: kickoff plus steers of the current request, and of the two most recently completed requests. Gathered from the primary session when a conversation starts. Not a live pin object and not updated as a separate structure while the conversation runs — new user text just appends. Shown as user → implementing agent, never as a message to the advisor.
- **Advisor conversation.** One advisor context lifetime: from identity change or advisor compact until the next compact. Curator persists do not end it.
- **Advisor compact.** New advisor conversation when Pi would compact this session. Produced by the advisor session's `session_before_compact` handler (not VCC, not `#softReset`, not a private 96k check): live fold + recent user messages + rolling list; no old deltas. Pending then drains.
- **Frame.** Already-reviewed advisor-formatted primary deltas since this advisor conversation started. Unreviewed deltas are the **batch**, not the frame.
- **Ledger snapshot.** Folded current law plus visible observations copied at advisor conversation start and held unchanged until the next conversation start.
- **Prefix.** Prompt region intended to be cache-stable for the conversation: ledger snapshot, then recent user messages collected at seed. It is not the working frame. Mid-conversation user text appends after this; it does not rewrite it.
- **Batch.** Unreviewed pending deltas, in push order. A successful drain reviews the batch once, then those deltas join the frame.
- **Trajectory delta.** One primary turn as shown to the advisor: thinking, assistant text, every tool's name and arguments, success/error and exit code. Observation and command results are receipts (`decisions/observation-receipts.md`). Successful edit diffs are never truncated.
- **Settled advice.** An advisor note that was delivered to the primary or dropped by silence. Distinct from a **held** note, which still needs reconfirm.
- **Rolling advice list.** The last eight settled notes, oldest dropped, with severity and disposition. Anti-repeat. Survives advisor compact and primary compact; clears on session identity change.
- **Visible reset.** Starting a new advisor conversation because the advisor session compacted. Previous messages including recall results are gone; the new seed is the live fold plus recent user messages and rolling settled advice.

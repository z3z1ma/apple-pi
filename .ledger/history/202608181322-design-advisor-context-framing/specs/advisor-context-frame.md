Status: active
Created: 2026-08-18
Updated: 2026-08-18

# Advisor context

## Purpose And Authority

Define what the advisor model is shown. Scheduling of reviews is `advisor-review-coalescing.md` in the sibling task. Vocabulary is `knowledge/advisor-frame-vocabulary.md`. The reduced scope is `decisions/advisor-is-a-regular-session.md`. Curator writes still do not reset the advisor (`decisions/advisor-resets-on-its-own-budget.md`). Prefix contents and stance remain `decisions/om-snapshot-prefix-curator-frame.md` as amended. Delta leanness is `decisions/observation-receipts.md`.

This spec now governs the shipping implementation.

The advisor is an ordinary accumulating session. Two changes only: lean deltas at push, and a `session_before_compact` handler that reseeds instead of summarizing. Pi's compact trigger is the clock. See `knowledge/conversation-not-a-frame-machine.md` and `decisions/advisor-is-a-regular-session.md`.

## Actors And Boundaries

- **Advisor runtime** owns the nested advisor conversation plus small seed lists: recent user messages collected at seed time, recent trajectory, rolling settled advice, held notes.
- **Curator** is the only summariser of discarded transcript. A curator persist MUST NOT rewrite or reset the advisor conversation. The advisor reads the live fold only when it seeds a new conversation.
- **Primary session** is the source of user messages, steers, and turn deltas. Observational memory may be disabled or empty; the advisor MUST still review.
- **VCC / primary compaction** MUST NOT reset the advisor conversation and MUST NOT inject `formatActiveSessionContext`.
- The advisor keeps `read`, `grep`, `find`, and `advise`, and SHALL also have `memory_source` and `session_search` bound to the **primary** session branch and session file. Those two tools MUST NOT search the advisor's private messages. They count toward the existing 2–3 tool-call exploration budget.

## Required Behavior

### Seed once, then append

At conversation start, inject this seed into the nested agent, in order, then stop rewriting it:

1. System prompt (existing protocol, plus: the snapshot is orientation; live user text and newer work win).
2. Live curator fold at that moment: current law, then visible observations. MUST NOT reuse the primary compaction usage instructions. Omit if empty.
3. Recent user messages collected from the primary session: the current request (kickoff plus steers so far) and the two most recently completed requests. Label completed ones prior. Each MUST be marked as user → implementing agent, not as a message to the advisor. Omit if empty.
4. Recent primary trajectory: the last 8 implementing-agent turns as receipts
   (thinking, tool intents, edit diffs, `call:` addresses) plus any user bash
   in that tail. Omit if empty.
5. Rolling settled advice (last 8 delivered or dropped notes). Omit if empty.

After seed, the conversation is normal:

- Each drain appends the reconfirm preamble (if any holds) plus the pending deltas, once.
- `memory_source` / `session_search` results remain in the nested agent's messages until the next reset. There is no parallel scratch store and no per-drain rebuild.
- New user text — kickoff or steer — appends as an ordinary transcript quote. It is not a pin object, not a prefix rewrite, and not a reason to reserialize snapshot or history. It is not a turn addressed to the advisor.
- Curator persists do nothing to this conversation.

### Conversation start

A conversation begins on session identity change (start, tree, handoff) and when the advisor session compact handler runs.

- Identity change uses `reset()`: collect recent user messages from the *new* session, clear the rolling list, discard pending with today's documented `reset()` behaviour, and clear the advice queue. Then seed. Seeding before that clear would plant the previous session's user messages and settled notes.
- Compact is the handler result only. MUST NOT also `#softReset` or `reset()`. Keep the rolling list, held notes, and pending batch. The handler's seed is live fold + re-collected recent user messages + recent trajectory + the kept rolling list. Then drain the pending batch into the new conversation.

### User messages

- User text is ordinary conversation, not a maintained pin stack.
- Every kickoff and every mid-turn steer SHALL be appended when it arrives. Classification skips custom entries and looks back to the last message. Advisory customs are not steers.
- The live path MUST NOT rely on a single `pendingUserPrompt` consumed at the first `turn_end`.
- At seed time only, gather the last few user messages as specified above. A full direction change is just a newer user message: it is current intent even if the seeded snapshot still describes the old goal. Older goals survive in the seeded snapshot only if they were in the fold at last seed.
- Primary user text and implementing-agent text are quoted transcript, never unwrapped as the advisor's own user/assistant roles. A heading MUST show the user is speaking to the implementing agent the advisor is watching, not to the advisor. Assistant text in a delta is that agent, not a prior advisor reply. Today's production heading is `#### User` inside a `### Session update` user-role wrapper plus the system-prompt stance; that heading is too thin for the new append path. Exact copy is an implementation detail; the addressee MUST be unmistakable.

### Deltas

- Every primary `turn_end` that is pushed today SHALL still be pushed, in order.
- Each delta is a **trajectory record**, not a copy of the primary turn. MUST include thinking, assistant text, every tool's name and arguments, and success/error plus exit code when present. Result bodies are compiled receipts (`decisions/observation-receipts.md`): `grep` keeps match/file counts and file:line loci without source text; `read` keeps requested/returned range and line/byte counts without the file body; `find` / `ls` keep counts, limit flags, and at most 20 names; successful bash is counts only; failed bash keeps a 20-line / 1,500-character tail; successful edit keeps the full line-numbered diff; successful `write` omits `content` and keeps path plus size; failed `write` keeps a truncated attempted body; everything else, including non-bash errors, uses the 40-line / 2,000-character truncate cap. Every tool result with a `toolCallId` starts with `call: <id>`.
- User-typed `!bash` that is not excluded from context SHALL be pushed as its own `#### User bash` page when `SessionManager.appendMessage` records the `bashExecution`. It is not low-signal. `message_end` does not carry this role.
- Unreviewed deltas sit in pending. A successful drain appends them to the nested conversation. They MUST NOT be injected a second time.
- Do not drip-delete old messages. Bounding is Pi compact.

### Conversation compact

- The advisor is a regular compactable session. Pi's default `shouldCompact` (`contextTokens > contextWindow - reserveTokens`) is the clock. There is no private formatted-token budget and no `ADVISOR_COMPACT_AT`.
- The advisor `session_before_compact` handler SHALL return the seed (live fold + recent user messages + recent trajectory + rolling settled advice) as the compaction result and SHALL keep no prior advisor deltas. It MUST NOT be VCC's hook and MUST NOT run an LLM summarizer.
- After compact, the pending batch drains into the new conversation. Overflow recovery (`willRetry`) is the same hook, not a second clock.
- If after that compact, seed + one batch still cannot fit, the review fails visibly. MUST NOT omit snapshot, recent user messages, recent trajectory, or the rolling list to make it fit. MUST NOT loop compact.
- `#softReset` / `ADVISOR_COMPACT_AT` percentage self-compaction is superseded. `Agent.transformContext` MUST NOT rebuild the seed.

### Rolling settled advice

- After a note is steered in, or dropped by silence on a successful reconfirm, append it to the rolling list and evict the oldest if the list would exceed 8.
- Held notes stay only on the reconfirm preamble attached to the next drain.
- The list is re-injected at the next seed so a new conversation still knows what was already said. It survives advisor compact and primary `session_compact`. Identity change and `reset()` clear it.

### History rewrites

- Primary `session_compact` SHALL leave the advisor conversation in place.
- Advisor `session_before_compact` is the reseed path above, not a second wipe.
- Session start, tree navigation, and handoff SHALL start a new conversation via `reset()` as specified under Conversation start.

## Error And Failure Behavior

- Curator failure, empty backoff, or successful persist: no advisor context change.
- Seed fold copy fails: seed without snapshot and continue.
- Disabled or empty observational memory: seed without snapshot; do not disable the advisor.
- Advisor compact is a visible new conversation, not a silent shortening of the same one.

## Given-When-Then Scenarios

- Given a curator persist mid-conversation, when the next review runs, the nested advisor messages SHALL be unchanged except for the new appended batch.
- Given several successful curator passes before the advisor session compact, the seeded snapshot SHALL remain the fold from conversation start.
- Given pending unreviewed deltas, a drain SHALL append each once and MUST NOT also re-inject earlier reviewed deltas.
- Given a snapshot id, `memory_source` SHALL resolve it on the primary branch, and that tool result SHALL remain in the advisor conversation until the next advisor compact.
- Given advisor compact after a recall, the new conversation SHALL start from the live fold and SHALL NOT contain the previous conversation's recall messages.
- Given a delivered concern, it SHALL appear on the rolling list and not on reconfirm. After advisor compact it SHALL be in the new seed.
- Given a mid-turn steer, that text SHALL already have been appended as a quoted user → implementing-agent message before the next delta is formatted.
- Given primary user text in the advisor conversation, the advisor MUST be able to see it is not addressed to the advisor.
- Given a new user request that contradicts the previous goal, the new message is current intent even if the seeded snapshot still describes the old goal.
- Given a snapshot that says a task is done and a newer delta that shows it is not, the advisor MAY raise advice.
- Given `session_compact` on the primary, the advisor conversation SHALL still be the same accumulating messages.
- Given Pi compact on the advisor session, the before-compact handler SHALL return the live fold plus recent user messages plus recent trajectory plus rolling notes and no old deltas, and then the pending batch SHALL append.
- Given a successful `write`, the pushed delta SHALL include path and size and MUST NOT include the file `content`.
- Given a persisted user `!bash` that is not excluded from context, the advisor SHALL receive a `#### User bash` page.
- Given a receipt `call: abc`, `session_search` query `call:abc` SHALL return the persisted primary tool-result body.
- Given a successful `grep`, the pushed delta SHALL include arguments, match and file counts, file:line loci, and truncation flags, and MUST NOT contain matching source text.
- Given a successful `read`, the pushed delta SHALL include arguments, requested/returned range when known, line/byte counts, and truncation flags, and MUST NOT contain the file body.
- Given a successful `find` or `ls`, the pushed delta SHALL include arguments, the entry count, at most 20 names, and limit flags, and MUST NOT dump the full listing.
- Given a successful bash, the pushed delta SHALL include arguments, exit status, and line/byte counts, and MUST NOT contain the output body.
- Given a failed bash, the pushed delta SHALL include those counts plus a tail of at most 20 lines or 1,500 characters.
- Given a successful edit, the pushed delta SHALL keep path, block count, and the full line-numbered diff.
- Given a failed edit or a non-bash tool error, the pushed delta SHALL keep the attempted arguments, exit or error status, and a truncated error body.

## Acceptance Mapping

- AC-001: User messages section and the direction-change scenario.
- AC-002: Seed-once snapshot, then append; advisor compact is the only roll.
- AC-003: No advisor-authored summary. Replacement text at reset is the live curator fold.
- AC-004: Live holds on the next drain preamble. Settled notes on the rolling list, re-seeded after reset. A note is never in both.
- AC-005: Cache is the accumulating conversation until reset. Curator writes do not invalidate it. A new user message appends; it does not rewrite the seed.
- AC-007: Advisor compact is the overflow path; single-batch still-too-large fails visibly.

## Exclusions

- When the model is called (sibling spec).
- Severity, hold-and-reconfirm semantics, delivery, catch-up wait duration.
- Advisor cost ceilings.
- Changing curator cadence or observational-memory enablement.

## Assumptions And Provenance

- Operator session 2026-08-18: curator persist must not drive reset; this is a conversation with a manual window reset, not a per-drain assembler.
- Operator session 2026-08-18: user text appends normally; last few user messages are collected only when recreating the conversation. "Pin" is not a live object.
- Operator session 2026-08-18: deltas are trajectory (thinking, text, calls, args, exit), not primary tool-result payloads.
- Mid-turn steers exist as user-role entries; live advisor formatting does not yet append them after the first `turn_end`.
- Advice quality versus history depth, quality of the reset handoff, and quality of reviews without result bodies are **Not verified**.
- A private 96k conversation budget is rejected. The session uses Pi compact. Review quality in a long lean conversation is **Not verified**.

## Related Records

- `decisions/om-snapshot-prefix-curator-frame.md`
- `decisions/advisor-is-a-regular-session.md`
- `decisions/advisor-resets-on-its-own-budget.md`
- `decisions/advisor-recall-and-rolling-notes.md`
- `decisions/observation-receipts.md`
- `decisions/lean-trajectory-deltas.md`
- `knowledge/advisor-frame-vocabulary.md`
- `knowledge/conversation-not-a-frame-machine.md`
- `.ledger/202608181322-coalesce-advisor-reviews/specs/advisor-review-coalescing.md`

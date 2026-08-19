Status: active
Created: 2026-08-18
Updated: 2026-08-19

# Design advisor context framing

## Scope

Settle what the advisor's context should be, then implement the adopted design:
lean trajectory receipts, a regular advisor session whose compact hook reseeds,
and primary-bound `memory_source` / `session_search`.

## Non-goals

- Review coalescing / when reviews fire. That remains `.ledger/202608181322-coalesce-advisor-reviews/task.md`.
- Changing severity policy, hold-and-reconfirm, delivery, or the bounded catch-up wait.
- Adopting the reference implementation's non-blocking dispatch model, parked separately in
  `.ledger/history/202608181148-advisor-ux-reviewing-state-footer-bordered-advisory-card/`.
- Advisor cost ceilings or spend caps.
- Scout / LLM observation compressors, evidence-handle stores, `expand_observation`, typed IR
  compilers, and sparse invocation beyond the coalescing sibling.

## Acceptance Criteria

- AC-001: The spec states how user intent is preserved, covering the message that starts a turn
  *and* every subsequent steering message, and states what happens when the user changes direction
  entirely rather than refining.
- AC-002: The spec defines the context structure — what is anchored and never evicted, what rolls,
  and what is discarded — and justifies it against the alternative of a plain sliding tail.
- AC-003: The spec defines the summarisation contract: what produces a window summary, how many
  are retained, where they sit in the prompt, and what happens when summarisation fails.
- AC-004: The spec defines which prior nudges are carried forward and how they relate to the
  existing hold-and-reconfirm mechanism, which already re-offers live concerns and blockers.
- AC-005: The spec states the expected prompt-cache behaviour of the chosen structure, including
  what invalidates the cached prefix and roughly how often.
- AC-006: A decision record chooses framed, sliding, or status quo, with steelmanned alternatives
  and consequences — or explicitly defers with named revisit conditions.
- AC-007: Failure boundary — the spec says what the advisor does when a single frame cannot fit,
  and that behaviour degrades visibly rather than silently reviewing less than it appears to.

## Work Items

- [x] WI-001: Research how the reference implementation manages advisor context.
      Recorded in `research/pi-advisor-context-management.md`. Result: nothing adoptable; it uses
      a newest-first byte tail with a fraction-of-window private budget, preserves intent only by
      instruction, authors no summaries, re-injects no prior nudges, and has no caching design.
- [x] WI-002: Draft the spec covering AC-001 through AC-005 and AC-007.
      Recorded in `specs/advisor-context-frame.md`.
- [x] WI-003: Hold the design session with the operator.
- [x] WI-004: Record the decision, including what was rejected and why.
      Recorded in `decisions/om-snapshot-prefix-curator-frame.md`.
- [x] WI-005: Replace line-count exploratory omit with deterministic observation receipts.
      Recorded in `research/observation-projection.md` and `decisions/observation-receipts.md`.
- [x] WI-006: Bind `memory_source` and `session_search` to the primary session manager.
      Wrappers in `components/advisor/src/recall.ts`; session allowlist includes both names.
- [x] WI-007: Address the remaining projection holes: `call:<id>` on receipts with
      `session_search` lookup, recent trajectory in the compact seed, omit successful
      write content, and live user-bash pages via appendMessage (not message_end).

## References

- `research/pi-advisor-context-management.md`
- `research/observation-projection.md`
- `specs/advisor-context-frame.md`
- `decisions/om-snapshot-prefix-curator-frame.md`
- `decisions/advisor-recall-and-rolling-notes.md`
- `decisions/advisor-resets-on-its-own-budget.md`
- `decisions/observation-receipts.md`
- `decisions/lean-trajectory-deltas.md`
- `decisions/advisor-compaction-override.md`
- `knowledge/advisor-frame-vocabulary.md`
- `knowledge/conversation-not-a-frame-machine.md`
- `decisions/advisor-is-a-regular-session.md`
- `.ledger/history/202608181322-account-sidecar-model-usage/task.md` — sidecar usage has landed
- `.ledger/202608181322-coalesce-advisor-reviews/task.md` — scheduling sibling; spec at
  `specs/advisor-review-coalescing.md`
- `docs/advisor.md`
- `components/advisor/src/receipts.ts`
- `components/advisor/src/recall.ts`
- `components/advisor/src/session.ts`

## Assumptions

- The advisor's value comes primarily from recent trajectory plus durable user intent, not from
  deep history. **Not verified** — it is the operator's stated model and the premise of the whole
  design, but no experiment has tested advice quality against history depth.
- Prefix is current law plus all visible observations, snapshotted at advisor conversation
  start and held until the next conversation start. **User-ratified** 2026-08-18; curator writes
  do not refresh it.
- Working conversation is seed-once-then-append. Compact is Pi's session compact,
  not a private 96k budget. **User-ratified** 2026-08-18.
- Last few user messages are collected only at seed (current request plus two completed).
  Mid-conversation they just append. **User-ratified** 2026-08-18; "pin" is not a live object.
  Shown as user → implementing agent, not as a message to the advisor. **User-ratified**
  2026-08-18; production heading is `#### User → implementing agent`.
- Deltas keep inputs and status for every tool. Observation and command results are receipts,
  not line counts and not raw bodies. **User-ratified** 2026-08-18 in
  `decisions/observation-receipts.md`, superseding the exploratory line-count omit. Successful
  edit diffs stay whole. No second tool-result store.
- Snapshot is evidence; live user text and newer deltas win. **User-ratified** 2026-08-18.
- Steering messages sent mid-turn are distinguishable from the turn's kickoff message.
  **Partially verified** 2026-08-18. A structural discriminator exists and needs no heuristic:
  `agent_start` fires once per user request and resets `_turnIndex`, `agent_end` closes it, and
  `turn_end` fires per assistant step in between
  (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:440-464`); our
  advisor already captures the kickoff separately at `before_agent_start` via `event.prompt`
  (`components/advisor/src/extension.ts:1068-1077`). So the kickoff is known, and anything
  arriving before `agent_end` is mid-turn.
  Mid-turn steers **do** surface as ordinary user-role session entries. **Verified** 2026-08-18
  by classifying every user entry in the 15 most recent sessions by its predecessor entry:
  15 session-opening, 15 preceded by a terminal assistant message (kickoffs), and 2 preceded by
  a `toolResult` — genuine mid-run steers, e.g. "Actually it could also be advisor."

  Method note for whoever specifies this: an earlier scan looking for *consecutive* user-role
  entries returned zero and was invalid — a mid-run steer is always followed by the assistant's
  next step, so its predecessor is never another user entry and zero was guaranteed regardless
  of ground truth. The correct discriminator is the predecessor: a user entry preceded by an
  assistant message carrying tool calls, or by a `toolResult`, is a mid-run steer; one preceded
  by a terminal assistant message (no tool call — the same test the advisor already uses for
  terminality) is a kickoff.

  One refinement remains for the spec: 7 user entries in that scan were preceded by `om.*` or
  `advisory` custom entries, which are appended asynchronously and so mask the real predecessor.
  The discriminator must skip custom entries and look back to the last message entry.
  Advisor-originated steers land as `custom` entries with `customType: "advisory"` and are not
  user-role entries, so they do not pollute this classification.

## Journal

- 2026-08-18: Created from a chat-only design discussion. Operator's sketch: pin the turn-kickoff
  message plus all steering messages as durable intent; run a recent tail of the transcript;
  summarise each window as it closes and roll a few summaries plus the last few nudges into the
  next window; prefer a fixed anchor with a bounded frame over a sliding window, so the prefix
  stays cacheable until the frame rolls.
- 2026-08-18: Reference research completed. It does not solve any of the three goals, so this is
  design work rather than adoption.
- 2026-08-18: Joint design session started with the operator, covering this task and
  `.ledger/202608181322-coalesce-advisor-reviews/task.md` together. New proposal: treat
  observational-memory current law, and possibly visible observations, as the advisor's stable
  prefix so framed context can substitute for accumulated deltas rather than sit on top of them.
- 2026-08-18: Design session recorded. Framed context chosen: coverage-write snapshot of law plus
  visible observations, held steady until the next coverage write; frame is post-coverage deltas
  with a 96k formatted overflow cap; live pin plus two prior requests; evidence stance; no
  advisor-authored summaries; primary compact does not wipe advisor state. Coalesce drain/settle
  coupling and empty-curator unbounded growth written into the specs as failure boundaries.
- 2026-08-18: Operator added primary-bound `memory_source` and `session_search`, and a rolling
  list of the last 8 settled nits/concerns/blockers, distinct from live hold-and-reconfirm.
- 2026-08-18: Operator corrected the picture: not a per-drain frame assembler. Ordinary
  conversation; no compaction; manual window reset at the advisor budget, seeded from the live
  curator fold. Curator persists do not reset the advisor.
- 2026-08-18: Operator: user text appends normally; last few user messages are gathered only
  when recreating the conversation. Deltas must stay lean — thinking, text, calls, args, exit
  — so the advisor does not copy the primary token bill. Recorded in
  `decisions/lean-trajectory-deltas.md`.
- 2026-08-18: Verified `write` vs `edit` in Pi tools. Write content is the argument; success
  result is a byte-count receipt. Edit result is a computed `details.diff`. Write stays in
  the truncate bucket; edit stays never-truncated.
- 2026-08-18: Operator: reset by overriding compaction on the advisor session the way VCC
  does, plus lean tool-result policy. Recorded in `decisions/advisor-compaction-override.md`.
  Verified today's advisor is a bare `Agent` with `#softReset`; `session_before_compact` is
  an AgentSession hook. Implementation must attach that surface without loading VCC.
- 2026-08-18: Operator: no 96k budget. Regular session. Two changes only — lean tool
  results, and compact reseeds (fold + nits + user trajectory) instead of summarizing.
  Recorded in `decisions/advisor-is-a-regular-session.md`.
- 2026-08-18: Implementation started. Lean `formatTurnDelta`; thin in-memory advisor
  session with inline `session_before_compact` reseed; `#softReset` / `ADVISOR_COMPACT_AT`
  removed; primary compact no longer reprimes. Advisor tests 88/88.
- 2026-08-18: Sibling coalescing implementation started in the same working tree.
- 2026-08-18: Operator correction: advisor context is a trajectory projection. Line-count
  omit superseded by deterministic receipts. Scout, evidence store, and typed IR deferred.
  Advisor tests 96/96. `tsc` clean on this increment.
- 2026-08-18: Primary-bound recall: thin wrappers inject the root `sessionManager` so
  `memory_source` / `session_search` cannot search the nested advisor conversation.
  `createAgentSession({ tools })` is an allowlist; `advise` and both recall names are on it.
  Advisor tests 99/99. `tsc` clean. VCC recall 9/9.
- 2026-08-18: Operator: address evidence addresses, compact skeleton, write-content
  dump, and live user-bash; skip critique-preservation proof. Implemented `call:<id>`
  receipts + session_search lookup, last-8 trajectory in the seed, omitted successful
  write content, and `!bash` via appendMessage observer.
- 2026-08-19: Advisor compact still reseeds in one handler. On xAI Responses it also
  calls `/responses/compact` and stores the opaque item; replay/4xx hooks live in the
  same factory. Parent OM packet is inserted after the compaction summary; fold left
  the reseed text so it is not duplicated.

## Blockers

None.

## Evidence

- WI-006: `bindPrimaryRecallTools` ignores a decoy caller `sessionManager` and resolves primary branch / session-file evidence. `createAgentSession({ tools })` includes `advise`, `memory_source`, and `session_search` (Pi drops unnamed custom tools).
- WI-007: Advisor tests 106/106. `tsc --noEmit` clean. VCC recall-files + recall-expand 8/8, including `call:<id>` recovery. Full suite **Not verified**. Live `!bash` and live `call:` during a real review **Not verified**. Critique-preservation vs full transcript **Not verified** (operator will accumulate empirically).
- Seed-on-throw: first prompt failure no longer drops orientation; retry still carries the seed. Covered by `runtime: a thrown first prompt keeps the seed for the retry`.

## Review

- 2026-08-18: Structured plan-review-verify over the working tree timed out at 1800s. Coverage of that pass is **Not verified**.
- 2026-08-18: Confirmed and fixed: `#needsSeed` was cleared before `prompt()`, so a thrown first review dropped orientation and the retry started unseeded. Seed now clears only after prompt returns.
- 2026-08-18: `firstKeptEntryId: "advisor-reseed"` is a non-matching sentinel; Pi then keeps no pre-compaction entries. Intentional, not a miss.
- 2026-08-18: Primary `session_compact` only refreshes the footer; it does not reprime or reset the advisor.

## Retrospective

Pending.

## Distillation

Pending.

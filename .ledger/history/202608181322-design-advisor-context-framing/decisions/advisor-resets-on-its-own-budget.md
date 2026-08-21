Status: active
Created: 2026-08-18
Updated: 2026-08-18

# Advisor context resets on its own budget, not on curator writes

## Context

The framed-context decision snapshotted observational memory on every curator coverage write and treated post-coverage deltas as the working frame. The curator typically writes every ~20k primary source tokens, often small observation churn. That would rebuild the advisor prefix on roughly the same cadence as memory consolidation, evict cache, and clear recall scratch — even though the advisor already sees the same live transcript the curator is compressing.

The operator rejected that coupling: both sidecars watch the same transcript, so a curator persist is not new information the advisor must ingest as a prefix rewrite. Hold the ledger image taken when the advisor conversation started. Only when the advisor hits the context limit we set for it should we start a new advisor conversation, taking whatever the curator has at that moment.

## Decision

Supersede the coverage-write frame clock in `om-snapshot-prefix-curator-frame.md` (points 2–4, 7, 10) and the “clear scratch on coverage write” rule in `advisor-recall-and-rolling-notes.md`.

1. **Curator writes do not touch advisor context.** Snapshot, frame, scratch, recent user messages already in the conversation, and rolling advice are unchanged by empty, failed, or successful curation.
2. **Snapshot at advisor conversation start.** When an advisor conversation begins (first review after identity change, or advisor compact), copy current law plus visible observations as they exist *then*. That copy stays frozen until the next advisor conversation start.
3. **Compact is a new conversation, produced by the advisor's compact override.** The private 96k budget is superseded by `decisions/advisor-is-a-regular-session.md`. Pi compact fires; the handler returns the live-fold seed; then the pending batch drains. Do not drip-delete oldest frame deltas.
4. **Both look at the same transcript.** Mid-conversation the advisor does not need the curator’s latest fold; it still has the raw deltas. After reset it needs the fold, because those deltas are being discarded.
5. **Rolling settled advice survives compact** (anti-repeat after the frame is gone). It still clears on session identity change. Recent user messages are not a live pin object; they are re-collected from the primary at seed time. Across compact those requests are still in the primary, so the same last-few set comes back.
6. **Identity change** is also a new conversation: live fold snapshot, recent user messages collected from the *new* session, empty frame, empty scratch, empty rolling list, pending discarded as today.

No advisor-authored summary. The curator’s current fold is the only replacement text at reset.

## Authority And Provenance

Operator, same design session, correcting the earlier “since last curator pass” clock: curator updates are frequent and pointless as an advisor trigger; reset only at the advisor’s own truncation point and take curator content as-is then.

## Alternatives Considered

**Refresh snapshot on every coverage write (previous decision).** Steelman: advisor prefix stays aligned with what the primary will see after compact; old frame deltas are dropped once they are in law. Rejected: ~20k cadence evicts a cacheable prefix for small observation churn, and the advisor already has those transcripts in the frame.

**Hold snapshot until curator pass, but still drop frame at coverage write.** Steelman: cheaper prefix, still bounds the frame to 20k source tokens. Rejected for the same reason: it is still a curator-triggered advisor rewrite.

**Drip-truncate oldest frame deltas at the cap, keep the same snapshot.** Steelman: preserves pins and snapshot cache, degrades gradually. Rejected; the operator wants the cap to mean “new advisor conversation” with a fresh curator image, not a sliding tail.

## Consequences

- Advisor prefix cache can survive many curator passes, which is the point of holding observations steady.
- After reset, the advisor may briefly lack raw deltas that have not yet made it into the fold. Recall tools and the new snapshot are the compensation. Quality of that handoff is **Not verified**.
- Empty-curator streaks no longer threaten unbounded growth by themselves; Pi compact is the bound.
- Implementation must not subscribe advisor runtime to curator persist events.

## Limits And Revisit Conditions

- A private conversation budget is closed; see `decisions/advisor-is-a-regular-session.md`.
- Revisit surviving rolling advice across reset if that list confuses a fresh conversation.
- Do not put curator persist back on the advisor hot path without a new operator decision.

## Related Records

- `decisions/om-snapshot-prefix-curator-frame.md`
- `decisions/advisor-recall-and-rolling-notes.md`
- `decisions/lean-trajectory-deltas.md`
- `decisions/advisor-compaction-override.md`
- `specs/advisor-context-frame.md`

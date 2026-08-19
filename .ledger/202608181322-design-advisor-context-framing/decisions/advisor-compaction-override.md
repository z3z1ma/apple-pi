Status: active
Created: 2026-08-18
Updated: 2026-08-18

# Advisor reset is a compaction override, not a private soft-reset machine

## Context

The advisor conversation is seed-once-then-append. Production implements reset as `AdvisorRuntime.#softReset` plus `ADVISOR_COMPACT_AT` percent-of-window, which is the machine this design retires. The private 96k clock that briefly replaced it is superseded by `decisions/advisor-is-a-regular-session.md`.

VCC already overrides compaction on a Pi session: it listens for `session_before_compact` and returns a `compaction` result (summary + `firstKeptEntryId` + details) instead of letting Pi's default LLM summarizer run. The operator's proposal is to use that same seam on the advisor's session. The handler does not summarize. It builds the seed we already specified: live curator fold, last few user messages, rolling settled advice.

A second, independent optimization is the lean trajectory delta: exploratory bodies omitted, other tools truncated, edit diffs kept whole.

## Decision

1. **Reset content is a `session_before_compact` handler on the advisor session.** Same extension point VCC uses on the primary. The handler returns a compaction whose `summary` (and any details needed to reconstruct the seed) is the seed specified in `specs/advisor-context-frame.md`. It MUST NOT call an advisor-authored summarizer. It MUST compact away the prior advisor messages (`firstKeptEntryId` such that no old deltas remain). Pending primary deltas are not in that session yet; they drain after the compact.

2. **That handler is not VCC.** VCC's cut and transcript summary are for the primary session. The advisor session MUST NOT load or share VCC's before-compact hook. Identity change is still a new conversation / `reset()`, not this compact.

3. **The compact clock is Pi's.** Superseded as a private 96k trigger by `decisions/advisor-is-a-regular-session.md`. `#softReset` / `ADVISOR_COMPACT_AT` remain superseded. The handler still runs because this is a regular session, not because we trip compact ourselves.

4. **Do not use `Agent.transformContext` for the reseed.** That hook runs before every `convertToLlm`. Rebuilding the seed there is the per-drain assembler we rejected.

5. **Lean deltas stay at push time.** Compaction override is how we throw the conversation away. Tool-result policy (`decisions/lean-trajectory-deltas.md`) is how each appended turn stays small. They are not the same code path.

## Authority And Provenance

Operator, same design session: override compaction on the advisor session the way VCC does everywhere else, so the reset is not a private conversation-rebuild; combine that with the already-specified tool-result policy.

Verified 2026-08-18:

- VCC registers `pi.on("session_before_compact", …)` and returns `{ compaction: { summary, firstKeptEntryId, tokensBefore, details } }`.
- That event exists on coding-agent `AgentSession` (`SessionBeforeCompactEvent`), not on a bare `Agent`.
- Today's advisor is `new Agent({…})` in `components/advisor/src/extension.ts` with `#softReset` clearing `agent.state.messages`. It has no session and no `session_before_compact`.
- `Agent` exposes `transformContext` for per-request pruning. Wrong lifecycle for a conversation reset.
- Default auto-compact threshold is window-relative, not an absolute 96k.

## Alternatives Considered

**Keep `#softReset` / `ADVISOR_COMPACT_AT`.** Steelman: already works on the bare Agent; no session promotion. Rejected: it is a second compaction system, percent-of-window, and it wipes without reseeding from the curator.

**Hook the primary `session_before_compact`.** Steelman: one session, no advisor session. Rejected: that hook is VCC's primary cut. Primary compact MUST NOT reset the advisor.

**`transformContext` rebuilds the seed every prompt.** Steelman: works on today's Agent, no session. Rejected: per-drain assembler.

**Let Pi auto-compact at `contextWindow - reserveTokens` and only customize the summary.** Trigger half now accepted in `decisions/advisor-is-a-regular-session.md`. Summary half still rejected: the handler reseeds, it does not summarize.

## Consequences

- Implementation must give the advisor a compactable session (or the same hook surface) and install this handler there. That is new wiring. It is not "zero code." What we delete is the private soft-reset / percent-of-window machine.
- The advisor session must not discover package extensions the way a child does today if that would load VCC onto it.
- Overflow `willRetry` is the desired recovery: reseed, then retry the in-flight review against the new seed.
- Quality of a compact-produced seed versus today's explicit `#softReset` is **Not verified**.

## Limits And Revisit Conditions

- If a compactable advisor session cannot be created without inheriting VCC or becoming a nested delegation surface, stop and redesign. Do not run VCC's cut on advisor messages.
- A private formatted-token cap is no longer a blocker. Do not add one back without a new operator decision.
- Do not restore `#softReset` as a second reset path.

## Related Records

- `decisions/advisor-resets-on-its-own-budget.md`
- `decisions/lean-trajectory-deltas.md`
- `specs/advisor-context-frame.md`
- `knowledge/conversation-not-a-frame-machine.md`
- `components/vcc/src/hooks/before-compact.ts`
- `components/advisor/src/extension.ts`

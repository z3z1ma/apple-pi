Status: active
Created: 2026-08-18
Updated: 2026-08-18

# pi-advisor's non-blocking advice delivery model

## Question

Our advisor blocks the primary turn's next step (`await runtime.waitUntilSettled(...)`
inside `turn_end`, `components/advisor/src/extension.ts`) so a held concern/blocker can be
reconfirmed and delivered before the primary goes idle. This is a deliberate, bounded stall
(15s→30s→60s… capped at 120s, Escape-abortable). Does `ribbons-digital/pi-advisor`
(https://github.com/ribbons-digital/pi-advisor) solve the same "don't let the user walk away
from an unraised blocker" problem without blocking, and if so, is that approach worth adopting
here?

## Method

Cloned `ribbons-digital/pi-advisor` (commit at time of research: default branch, package
version 0.3.0) into a scratch directory and read `src/index.ts`, `src/runtime.ts` (~4200
lines), `src/delivery.ts`, and `src/presentation.ts` in full. Cross-checked against the
screenshot in `docs/assets/advisor-in-action.png` and the README feature list. No code from
that repository was copied; only its architecture was studied.

## Findings

**They never block the primary turn.** `src/delivery.ts`'s `selectAdviceDispatch` routes each
piece of advice to one of three dispatch modes based on runtime state (primary idle/running,
memory-suggestion vs review, follow-up caps, forced-deferred/aborted):

- `steer` — inject into the still-running primary turn (our mid-run nit path, roughly).
- `deferred` — queue it; deliver later without stalling anything.
- `followUp` — once the primary is *already idle*, trigger an explicit new assistant turn
  (bounded: `REVIEW_FOLLOW_UP_SESSION_CAP = 5` per session) whose sole purpose is to act on
  the queued advice.

When a review finishes after the turn has already gone idle, `settleActiveAdvice` (wired to
Pi's `agent_settled` event) either appends the advice as a standalone "late advice entry"
custom session entry (rendered as its own card, no steer/turn needed) or spawns a capped
follow-up turn. There is no equivalent of our `runTurnBlock`/`waitUntilSettled` stall anywhere
in their code.

**The "is it working" signal is a persistent, continuously-updated footer state, not a
terminal message.** `formatAdvisorFooterStatus` + `shouldAnimateAdvisorFooter` in
`src/runtime.ts`/`src/index.ts` render `Advisor reviewing…` (with an animated spinner, driven
by a `setInterval`-based `ADVISOR_REVIEW_SPINNER_INTERVAL_MS = 80` tick) while a review is in
flight, and `Advisor active` / `Advisor paused` / `Advisor inactive` otherwise. Critically:
**there is no terminal "nothing to add" message in their system either.** Silence is the null
state for them exactly as it is for us. The actual fix for the ambiguity we set out to research
is not a completion message — it's making the working/idle state itself always visible, so a
silent outcome never leaves a dangling toast. That's the part we adopted (see Distillation).

**The richer visual in the screenshot is a message-renderer card, not a live widget.**
`src/presentation.ts` builds a bordered `Box` (background-filled via `theme.bg
("customMessageBg", ...)`, left rule colored by severity, bold "Advisor <SEVERITY>" heading,
markdown-rendered body, muted metadata line: delivery label, age, dedupe/mute/stale tags) as a
`Component` returned from their message renderer — delivered the same way our inline
`◆ advisor [NIT] …` line was, just with real chrome. It is not a persistent above/below-editor
widget (no `setWidget`).

## Scope reality check

pi-advisor is a substantially larger system than ours by design: mutes (`src/mutes.ts`),
memory suggestions (`src/memory-suggestions.ts`), soft token/cost caps, redaction
(`src/redaction.ts`), local transcript persistence with restart recovery, and per-provider
compatibility shims (`src/compatibility/`). Most of that solves problems (multi-provider model
drift, crash recovery, budget governors) we have not hit, and would be scope creep under Law of
Proportion if copied wholesale.

## Conclusion

Two findings were adopted immediately into `components/advisor/src/extension.ts` (see the
sibling task `task.md` for the closed acceptance criteria):

1. A persistent `Advisor` / `Advisor (reviewing)` footer state, refreshed both at `turn_end`
   and whenever `AdvisorRuntime`'s `onSettled` callback fires — not only a transient
   "catching up" toast.
2. A bordered, severity-colored advisory card (heading + readable body) replacing the single
   dim inline line.

The third finding — replacing our blocking catch-up wait with their `steer`/`deferred`/
`followUp` non-blocking dispatch plus capped auto-triggered follow-up turns — is deliberately
**parked, not adopted**. It is a materially different and larger architectural trade (a
blocker/concern can now land after the user has already walked away; auto-triggered follow-up
turns are new autonomous-turn surface; the dispatch/settle state machine is substantially more
complex than `runTurnBlock`). It deserves its own decision with the operator, not a drive-by
inside a UX-polish task.

## Revisit condition

Revisit this if either becomes true:
- The bounded 120s-cap blocking wait is reported as a real interruption to workflow (not just
  a visibility/ambiguity complaint — that part is now fixed by the footer state), or
- We want the advisor to act autonomously on advice after the primary has gone idle (which
  requires accepting new auto-triggered-turn surface area).

## Limits

Single-session code reading, no execution of pi-advisor's test suite, no interaction with a
live pi-advisor install. Version pinned to what `gh repo view` / `git clone` returned on
2026-08-18; upstream may have since changed.

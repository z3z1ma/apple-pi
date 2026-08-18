Status: done
Created: 2026-08-18
Updated: 2026-08-18

# Advisor UX: reviewing-state footer + bordered advisory card

## Scope

Implement the two concrete UX candidates identified from researching
`ribbons-digital/pi-advisor` against our own advisor's reported ambiguity ("catching up"
notified but never resolved; no visible working/idle state) in
`components/advisor/src/extension.ts`:

1. A persistent, self-resolving footer state (`Advisor` vs `Advisor (reviewing)`) so a glance
   at the footer always answers whether the advisor is still working, refreshed both at
   `turn_end` and whenever a review settles in the background.
2. A bordered, severity-colored advisory card (heading + readable body) replacing the single
   dim inline `◆ advisor [TAG] …` line.

Also: preserve the parked research on pi-advisor's non-blocking `steer`/`deferred`/`followUp`
delivery model in a durable, revisitable record.

## Non-goals

- Adopting pi-advisor's non-blocking delivery model (replacing our blocking catch-up wait with
  their steer/deferred/followUp dispatch and auto-triggered follow-up turns). Parked, not
  decided — see `research/pi-advisor-delivery-model.md`.
- Mutes, memory suggestions, soft token/cost caps, redaction, transcript persistence/restart
  recovery, or provider-compatibility shims. Out of scope; we have not hit the problems those
  solve.
- Animated footer spinner. The ambiguity's root cause is an unresolved state, not a lack of
  motion; a correctly-updated static label already fixes it without adding a new timer surface.

## Acceptance Criteria

- AC-001: The advisor footer status shows a distinguishable "reviewing" state while
  `AdvisorRuntime` is not idle, and reverts to the plain cost label once idle, including when
  the transition happens in the background (not only at the next `turn_end`).
- AC-002: The advisory message renderer produces a bordered, severity-colored card (heading +
  body) instead of a single dim inline line, for both single- and multi-note messages.
- AC-003: The pi-advisor non-blocking delivery investigation is recorded in enough detail
  (mechanism, file references, why it wasn't adopted now, revisit condition) to resume the
  decision later without re-researching from scratch.

## References

- `components/advisor/src/extension.ts` — `formatAdvisorFooterText`, `updateStatus`,
  `AdvisoryBorder`, the advisory message renderer, the `AdvisorRuntime` `onSettled` wiring.
- `components/advisor/tests/advisor.test.mjs` — `formatAdvisorFooterText` unit tests, bordered
  card render tests.
- `research/pi-advisor-delivery-model.md` — parked non-blocking delivery model investigation.
- Upstream research subject: https://github.com/ribbons-digital/pi-advisor.

## Assumptions

- The footer's `theme.fg`/`theme.bg` tokens (`accent`, `warning`, `error`, `text`, `dim`) used
  by the new card match the contrast rationale already established by the prior conversation-
  viewer contrast fix (readable body content uses `text`, not `muted`/`dim`). Confirmed by
  reading `docs/themes.md` and the shipped `dark.json` theme token list during implementation.
- No animation was added to the footer state. This was surfaced by the advisor's own review
  during this task (reuse existing spinner conventions or skip animation rather than copy
  pi-advisor's timer) and resolved by skipping animation: proportionate because the complaint
  was about an unresolved state, not motion.

## Journal

- 2026-08-18: Created the task bundle after implementing both UX changes and drafting the
  research record (work was completed directly in the session; the task formalizes and
  archives it rather than governing prospective execution).
- 2026-08-18: Implemented `formatAdvisorFooterText` + `updateStatus` footer wiring, the
  `AdvisoryBorder` component, and the rewritten advisory message renderer in
  `components/advisor/src/extension.ts`. Added `latestCtx` tracking so `AdvisorRuntime`'s
  `onSettled` callback can refresh the footer without waiting for the next `turn_end`.
- 2026-08-18: Added `formatAdvisorFooterText` unit tests and two new render-path tests (border
  prefix + heading structure; multi-note spacer) to `components/advisor/tests/advisor.test.mjs`.
  All 84 advisor tests pass (up from 81).
- 2026-08-18: Wrote `research/pi-advisor-delivery-model.md` documenting the non-blocking
  delivery model finding and why it is parked rather than adopted.
- 2026-08-18: Ran the full validation sequence (see Evidence). Pre-existing, unrelated
  format/lint failures were observed in `components/memory` (untouched by this task) and are
  recorded here rather than fixed, per Law of Proportion.
- 2026-08-18 (post-closure correction): the persistent advisor flagged, twice, that the two
  unresolved `ui.notify("advisor: catching up before the turn ends…" / "advisor: waiting up to
  Ns to catch up…")` calls in `runTurnBlock` were still present after this task's initial close
  — the original AC-001 implementation added the footer signal but never removed the toast it
  was meant to replace, so the reported symptom (a message with no resolution) still shipped.
  Verified the claim against the code (present at the two call sites just before
  `runtime.waitUntilSettled`), agreed it was a real gap, and removed both calls, keeping only
  the timeout/failure-outcome notify (a resolved, concrete result, not an in-progress wait).
  Added a regression test asserting no notify fires during either wait path while the
  timeout-failure notify still does. Re-ran `npm run test:advisor`: 85/85 passed (up from 84).

## Blockers

None.

## Evidence

- `npm run test:advisor` (`node components/advisor/tests/advisor.test.mjs`): 85/85 passed
  (was 81/81 before this task; 4 new tests cover AC-001 and AC-002, including the post-closure
  regression asserting the catching-up toast is gone and the timeout-failure notify remains).
- `npx tsc --noEmit -p .`: no errors.
- `npx biome check --write components/advisor/src/extension.ts
  components/advisor/tests/advisor.test.mjs` then re-check: no fixes remaining, 0 errors.
- `npm run typecheck`: passes (full repo).
- `npm run test:loader` (`node tests/package-load.mjs`): "apple-pi: all extension entrypoints
  loaded" — no new/changed extension entrypoints, surface unaffected.
- `npm run pack:check`: succeeds, 168 files, package builds without error.
- `npm run format:check` / `npm run lint` (full repo): both report pre-existing failures
  confined to `components/memory/src/session-ledger/projection.ts`,
  `components/memory/tests/consolidation-trigger.test.ts`, and
  `components/memory/tests/drain.test.ts` — none of which this task touched. `git status`
  confirms only advisor files and this ledger bundle are modified/new. AC-003 (the research
  record) is evidence-of-existence, not a runtime check; verified by reading the written file
  back and confirming it names the mechanism, file references, and revisit condition.
- Not verified: no interactive TUI session was run to visually confirm the rendered footer/card
  in a live terminal; verification is through the renderer/formatter unit and structural tests
  above plus the existing `CustomMessageComponent` test harness.

## Review

- The persistent advisor reviewed the implementation turn (nit): keep the parked research note
  out of `docs/boundaries.md` (that table is adopted/not-adopted only, no "parked" column) and
  prefer existing spinner/frame conventions over copying pi-advisor's timer verbatim if
  animation were ever added. Applied: the research record lives in this task's `research/`
  directory instead of `docs/boundaries.md`, and no new timer/interval was introduced.
- The same advisor caught a real gap after this task was first closed (concern, raised twice):
  the unresolved "catching up"/"waiting up to Ns" `ui.notify` calls in `runTurnBlock` were never
  removed, so AC-001's stated fix (footer replaces the toast) was only half true — the toast
  was still shipping the original symptom alongside the new footer. Verified against the code
  and fixed; see Journal and Evidence above.

## Retrospective

Separating "is the state visible" from "should advice ever land after the user walks away" was
the key move: the first is a small, low-risk UX fix (a pure formatting function plus wiring);
the second is a real architectural trade that deserved to be named and parked rather than
implemented as a side effect of a UX task. Extracting `formatAdvisorFooterText` as a small pure
exported function (mirroring pi-advisor's own `formatAdvisorStatusShort`/`formatAdvisorStatus`
design) made the footer behavior directly unit-testable without standing up a full model+runtime
harness — worth doing again when a closure-internal decision is otherwise untestable.

Adding a new, better signal (the footer) is not the same as removing the old broken one, and
the first close of this task shipped exactly that half-measure: the footer landed, but the
unresolved "catching up" toast the whole task existed to fix was still there. "Additive" UX
changes need an explicit check for what the change was supposed to replace, not just what it
added — caught here by the advisor rather than by the acceptance criteria as written, which is
itself worth noting for how AC-001 gets phrased next time ("replaces the toast" as a stated,
checked condition, not just an implied side effect of adding the footer).

## Distillation

Both UX changes are shipped in `components/advisor/src/extension.ts` and covered by
`components/advisor/tests/advisor.test.mjs`; no further promotion needed for those. The
parked delivery-model research stays in this archived task's `research/` directory as the
durable record for a future revisit — if that revisit turns into real work, it should start as
a new task that reads `research/pi-advisor-delivery-model.md` rather than re-researching
pi-advisor from scratch.

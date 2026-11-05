## file

WorkplaceReviews is the Reviews app: a resizable list of review cards beside the selected review's header, progress line and evidence tabs. The repository selector filters the queue; the empty value means every review in the operator's organization. A `request` from the shell (Code's **Open in Reviews**) clears the filters and selects that review; the queue's `around` then returns the page that holds it.

Clear a sent review comment only when the field still equals the submitted draft.
Why: text typed during that request is a new draft and must survive completion of the prior send.

Review reads are on demand, separate from the world snapshot. Bind every async payload to its complete request identity before rendering: switching from summary to source renders once before effects clear old state, so late-result fences alone cannot prevent a summary being read as a source object. Scope queue snapshots to their requested directory too. A built Chrome navigation test reproduced this crash and now exercises the transition.

While the app is visible the queue reloads on a two-second tick, and the Log and Mail tabs reload under the same request key, so the shown page stays until the new one arrives instead of flashing a loading state; other tabs load once per key. Nothing reads while hidden. The page size is the list's height divided by the card height.

A review shown selected while the app is visible is marked seen at its current state, including each later state while it stays selected: the operator is watching it. The rail badge and the cards' "was …" labels come from `updates` (workplace-review-updates.ts), not from the queue.

The progress line derives its step from the summary: queued or capturing is the first step; running uses `phase.kind` (planner, then focused or integration as inspecting, then validation); settled states end on Settled; failed, interrupted and cancelled stop at the step they reached, in their own tone. It is a reading of `state`, `phase` and `passes`, not a separate record.

Evidence views live in workplace-review-views.tsx, one purpose-built view per part; no part falls back to raw text or JSON in a code block, and the browser test asserts that for every tab. They trust the shared reader shapes from review-read.ts; a reader shape change must update its view.

Queue requests anchor the selected review with `around` and accept the returned page offset, matching the TUI queue's selection behavior.
Why: live reordering must keep the selected review on the shown page rather than selecting a different row at the old offset.

Mutation retries preserve the original attempt and arguments after uncertainty; the capture dialog keeps its pending request and offers only that retry. Cancel, Resume and Ask for more confirm in WorkplaceDialog. Management cannot submit approval; only the captured browser page carries the human verdict. The backend/runtime and actual bundled Electron probe test different boundaries than the renderer fixture.

Coupled: apps/agent-workplace/web/workplace.tsx, apps/agent-workplace/web/workplace-review-updates.ts, apps/agent-workplace/web/workplace-reviews.css, apps/agent-workplace/src/reviews.ts, apps/agent-workplace/src/backend/reviews.ts
Verify: apps/agent-workplace/tests/world-reviews.test.ts, apps/agent-workplace/tests/reviews-backend.test.ts

## file

Review reads are on demand, separate from the world snapshot. Bind every async payload to its complete request identity before rendering: switching from summary to source renders once before effects clear old state, so late-result fences alone cannot prevent a summary being read as a source object. Scope queue snapshots to their requested directory too. A built Chrome navigation test reproduced this crash and now exercises the transition.

Live reviews, and the Log and Mail tabs, refresh on a two-second tick that is off while the view is hidden. A tick reloads only live evidence (summary, log, mail) under the same request key, so the shown page stays until the new one arrives instead of flashing a loading state; other tabs load once per key. Controls use `section.wp-reviews` selectors because the Code pane's later `.wp-code button { font: inherit }` otherwise resets their size.

Evidence views live in workplace-review-views.tsx, one purpose-built view per part; no part falls back to raw text or JSON in a code block, and the browser test asserts that for every tab. They trust the shared reader shapes from review-read.ts; a reader shape change must update its view. The queue shrinks to its rows (at most QUEUE_SHARE of the panes) so a short queue leaves room for evidence; the page size comes from the panes' height, not the list's, because the list's own height follows its rows.

Mutation retries preserve the original attempt and arguments after uncertainty. Management cannot submit approval; only the captured browser page carries the human verdict. Opening Reviews hides rather than unmounts Monaco and terminals; closing it must retain dirty buffers without writes. The backend/runtime and actual bundled Electron probe test different boundaries than the renderer fixture.

Coupled: apps/agent-world/web/workplace-code.tsx, apps/agent-world/src/reviews.ts, apps/agent-world/src/backend/reviews.ts
Verify: apps/agent-world/tests/world-code.test.ts, apps/agent-world/tests/reviews-backend.test.ts

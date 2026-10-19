## symbol:REFRESH_MS

The list is read again every minute while the operator is in the forge, and on entering only when the last read is over ten seconds old; one read at a time.
Why: a listing is one `gh search prs` (GitHub's search API allows 30 a minute) plus a `gh pr view` for every searched pull request not found by an agent's branch; live on 2026-10-19 it listed 26 in about 11 s. Faster polling would spend the search quota and overlap reads.
Verify: apps/agent-world/tests/world-forge.test.ts

`window.agentWorldForgeRefreshMs` overrides the interval; only the headless test sets it.

## symbol:forge

`escape` declines a confirmation showing over the review page (`guard`) before it closes the panel: `PlaceDialog`'s window capture listener sees Escape before any listener the confirmation could add, since window capture listeners run in the order they were added.
Coupled: apps/agent-world/web/overlay/places/review.tsx, apps/agent-world/web/overlay/places/place-dialog.tsx

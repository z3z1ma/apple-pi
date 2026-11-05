## file

This suite loads the built Workplace in headless Chrome and enters Reviews through the bare landing route and the real rail button. The reviews API is an in-memory fixture over a mutable `window.reviewRows`; `states` and `queue` read the same rows, so changing a row's state in the page drives both the badge and the cards. Every mutation and capture is recorded, and the first enqueue throws to exercise the retained retry.

A plan recorded before scopes were paths has regions only, with no paths or risks; evidence views must not fall back to raw text or JSON in a code block, and the tab loop asserts that in light and dark.

The badge case seeds the seen map in localStorage before load, so the first poll compares against it instead of recording a baseline.

Run against a fresh `npm run build:workplace`, with one worker. AGENT_WORLD_SHOTS saves light and dark screenshots; look at them, since layout and colour are not asserted. Hidden radio inputs are clicked through their visible labels.
Coupled: apps/agent-workplace/web/workplace-reviews.tsx, apps/agent-workplace/web/workplace-review-updates.ts, apps/agent-workplace/web/workplace-review-views.tsx, apps/agent-workplace/web/workplace.tsx
Verify: apps/agent-workplace/tests/world-reviews.test.ts

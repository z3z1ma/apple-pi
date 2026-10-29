## file

Search derives only from the current World snapshot across all teams. Temporary identity flags and former status exclude people; role display uses the recorded title, not World's decorative role. Work uses registered workHistory and labels the recorded organization anchor separately from each person's current team.
Why: moving an assignee changes their current team, not the ownership of their historical tasks. An absent workHistory field means the snapshot cannot supply that history, so the UI reports it unavailable rather than claiming a complete empty archive.

Device-local organization names come from the existing useWorkplaceNames subscription and enter the pure projection as explicit data; renames update this mounted search without a new store. People retain their own names/IDs. Historical work uses its recorded head ID to resolve a display label, never the participant's current team. Open recorded team appears only when that exact anchor is a visible lasting root in the current chart; a retained metadata-only or now-nested anchor has no fabricated navigation target.
Coupled: apps/agent-world/web/workplace-names.ts, apps/agent-world/web/workplace-org-chart.tsx

Task bodies load only on Read task through the existing readTask allowlist. They render as escaped plain text, so links cannot navigate the window and remote content is not fetched. Query changes, closing, and another task selection invalidate stale asynchronous responses. Searching and selecting a person/team do not call transcript/read/seen APIs.

Escape handles only focus inside this component and stops the underlying profile Escape handler. Refocus happens before closing state.
Why: the input's focus handler opens results; reversing that order immediately reopens them when Escape came from a result button. Letting the same key reach the profile would also close unrelated UI.
The pure snapshot projection lives in workplace-org-search-model.ts; the component and focused Node tests use that same projection. Those tests verify result metadata, not rendered controls or side effects.
Why: the Node configuration cannot import TSX. Browser tests must separately prove explicit-only task reads, unchanged seen state, selection callbacks and Escape/focus behavior.
Coupled: apps/agent-world/src/world.ts, apps/agent-world/src/backend/workplace.ts, apps/agent-world/web/workplace-org.tsx, apps/agent-world/web/workplace-org-search-model.ts
Verify: apps/agent-world/tests/org-search.test.ts, apps/agent-world/tests/world-org.test.ts

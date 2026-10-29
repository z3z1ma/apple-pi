## file

The result panel is right-anchored to the search field but sized independently of the toolbar's allocated input width, with a viewport-relative width limit. Long IDs, project paths and task text wrap; results scroll rather than being truncated.
Why: the integrated toolbar screenshot showed a 205px input forcing task results into an unreadably narrow column. A wider right-aligned result panel preserves readable task content without widening the toolbar. Its viewport limit and the toolbar's placement must be verified together at narrow widths; this CSS alone does not prove the panel's left edge remains visible.
Coupled: apps/agent-world/web/workplace-org-search.tsx, apps/agent-world/web/workplace-org.css
Verify: apps/agent-world/tests/world-org.test.ts

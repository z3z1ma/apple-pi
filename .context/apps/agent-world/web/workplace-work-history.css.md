## file

This reusable panel inherits the Workplace palette in team cards, focused teams and profiles. Its selectors stay scoped so task Markdown and nested list controls remain readable without changing the embedding panel's layout. Compact mode folds the entire record list rather than truncating history to an arbitrary number of tasks.
Why: the same component sits inside profile and team-card styles; broad heading or list rules in either parent can silently override its task content.
Coupled: apps/agent-world/web/workplace-work-history.tsx, apps/agent-world/web/workplace.css
Verify: apps/agent-world/tests/world-org.test.ts

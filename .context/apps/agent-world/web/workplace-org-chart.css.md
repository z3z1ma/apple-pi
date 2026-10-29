## file

Keep the focused chart's scrolling selector more specific than the general `.wp-org-viewport` rule in workplace-org.css. Disable browser scroll anchoring only in the focused chart.
Why: the general rule hides horizontal overflow and can load after this stylesheet; equal specificity prevents ordinary horizontal trackpad panning once a tree is zoomed beyond its viewport. Browser scroll anchoring would compete with the chart's explicit pointer-anchored scroll adjustment.

Coupled: apps/agent-world/web/workplace-org-chart.tsx, apps/agent-world/web/workplace-org.css
Verify: apps/agent-world/tests/world-org.test.ts

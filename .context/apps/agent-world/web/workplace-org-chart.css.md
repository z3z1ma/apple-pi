## file

Keep the focused chart's scrolling selector more specific than the general `.wp-org-viewport` rule in workplace-org.css. Disable browser scroll anchoring only in the focused chart.
Why: the general rule hides horizontal overflow and can load after this stylesheet; equal specificity prevents ordinary horizontal trackpad panning once a tree is zoomed beyond its viewport. Browser scroll anchoring would compete with the chart's explicit pointer-anchored scroll adjustment.

Overview rows share content-derived height. Cards and their work-summary body flex so footers align at the bottom even when no history exists. Only the overview's direct task preview is clamped to two lines; its full DOM text and existing title remain, and full work-history dialogs stay unbounded by this preview rule.
Why: empty work cards otherwise lift their actions away from neighboring footers, while one long task title can stretch the overview into sparse rows. Fixed pixel heights would substitute another data-volume assumption.

Coupled: apps/agent-world/web/workplace-org-chart.tsx, apps/agent-world/web/workplace-org.css, apps/agent-world/web/workplace-work-history.tsx
Verify: apps/agent-world/tests/world-org.test.ts

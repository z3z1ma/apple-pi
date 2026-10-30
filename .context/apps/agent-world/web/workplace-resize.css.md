## file

The separators are native focusable hr elements, so reset their browser margins/borders while preserving the 6px layout track used by caller grids and measured bounds. The shield is a top-document portal rather than a Workplace child; it needs only transparent geometry/cursor styling, not inherited palette variables.
Why: pointer capture must stay usable across retained iframe boundaries, and ordinary hr defaults would otherwise add invisible spacing to a pane's size.
Coupled: apps/agent-world/web/workplace-resize.tsx, apps/agent-world/web/workplace-code.css, apps/agent-world/web/workplace-org.css, apps/agent-world/web/workplace-org-chart.css, apps/agent-world/web/workplace.css
Verify: apps/agent-world/tests/world-org.test.ts, apps/agent-world/tests/world-terminal.test.ts

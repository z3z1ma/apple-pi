## file

Keep the focused chart's scrolling selector more specific than the general `.wp-org-viewport` rule in workplace-org.css. Disable browser scroll anchoring only in the focused chart.
Why: the general rule hides horizontal overflow and can load after this stylesheet; equal specificity prevents ordinary horizontal trackpad panning once a tree is zoomed beyond its viewport. Browser scroll anchoring would compete with the chart's explicit pointer-anchored scroll adjustment.

`.wp-org-split` places the chart and the People directory side by side (`--wp-org-directory`, default 540px) and stacks them at <=1100px. The directory uses native aligned table columns with understated row dividers. Its own scroller retains all identity/status/manager/actions information when the split narrows; it must not expand the page or change chart panning. Trailing action cells stick to that table scrollport's right edge, with an opaque inherited row background, so narrowing does not hide the only visible menu affordance or paint scrolling metadata through it. Keep native profile/Message/lifecycle controls visible at rest and preserve square nonshrinking identity avatars and focus outlines. Identity text uses its own classes (`wp-org-directory-name`, `-role`) rather than element selectors, which Biome's descending-specificity rule flagged against the chart's heading rules.

Coupled: apps/agent-workplace/web/workplace-org-chart.tsx, apps/agent-workplace/web/workplace-org.css, apps/agent-workplace/web/workplace-work-history.tsx
Verify: apps/agent-workplace/tests/world-org.test.ts

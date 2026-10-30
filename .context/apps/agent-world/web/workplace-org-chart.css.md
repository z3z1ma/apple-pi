## file

Keep the focused chart's scrolling selector more specific than the general `.wp-org-viewport` rule in workplace-org.css. Disable browser scroll anchoring only in the focused chart.
Why: the general rule hides horizontal overflow and can load after this stylesheet; equal specificity prevents ordinary horizontal trackpad panning once a tree is zoomed beyond its viewport. Browser scroll anchoring would compete with the chart's explicit pointer-anchored scroll adjustment.

The full People directory uses native aligned table columns with understated row dividers. Its own horizontal scroller retains all identity/role/status/team/actions information when the center narrows around a right panel; it must not expand the page or change focused-chart panning. Trailing action cells stick to that table scrollport's right edge, with an opaque inherited row background, so narrowing the center around details does not hide the only visible menu affordance or paint scrolling metadata through it. Keep native profile/Message/lifecycle controls visible at rest and preserve square nonshrinking identity avatars and focus outlines. Only real teams receive overview cards; independent people remain ordinary directory rows.
Why: hiding management controls or replacing aligned columns with sparse singleton cards would miss the requested directory workflow, while forcing the whole chart viewport wide would compete with its separate pan behavior.

Overview rows share content-derived height. Cards and their work-summary body flex so footers align at the bottom even when no history exists. Only the overview's direct task preview is clamped to two lines; its full DOM text and existing title remain, and full work-history dialogs stay unbounded by this preview rule.
Why: empty work cards otherwise lift their actions away from neighboring footers, while one long task title can stretch the overview into sparse rows. Fixed pixel heights would substitute another data-volume assumption.

Coupled: apps/agent-world/web/workplace-org-chart.tsx, apps/agent-world/web/workplace-org.css, apps/agent-world/web/workplace-work-history.tsx
Verify: apps/agent-world/tests/world-org.test.ts

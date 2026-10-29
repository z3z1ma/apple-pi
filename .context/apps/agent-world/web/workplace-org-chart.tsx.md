## symbol:OrgChart

The operator rejected horizontal navigation across all independent hierarchies, then found the intermediate vertical outline less intuitive for dragging. The default is a responsive team overview; opening one team shows a conventional top-down chart fitted to that team's viewport. Zoom and pan stay local to that tree. Team navigation doubles as cross-tree drop targets. The Reports to selector proposes a change through the same confirmation path as drag/drop; it is not a second immediate mutation route.

The caller supplies only lasting people using authoritative temporary metadata, not role/title/name guesses. A missing visible parent makes a person an independent visible root. Team choices use stable session IDs, not status, so a status change does not rearrange navigation.

Avatar tiles have explicit square dimensions and a nonshrinking flex basis. The original fixed-width cards squeezed shared avatar spans; state and fit tests did not establish a usable overview. Keep rendered square-avatar, parent/sibling geometry and fitted horizontal-overflow checks at representative widths. Task context comes from recorded team work, distinct from the current members' work histories; it is not inferred from the reporting tree.

Chromium trackpad pinch arrives as ctrl+wheel. The focused chart owns a nonpassive native wheel listener while ordinary wheel scrolling stays native. Pointer anchoring captures graph coordinates before scaling and restores them through scroll offsets after layout; normal scroll edges can constrain that anchor when content fits. Pinch rejects nonpositive or nonfinite scales without adding range limits; the existing toolbar zoom range is unchanged.
Why: a passive wheel listener cannot prevent document zoom. Restoring scroll before React applies the new canvas dimensions anchors against the old geometry and moves the point under the pointer.

Overview/focused titles use local organization display preferences; person names and stable IDs remain unchanged. Card name editing is outside the person-profile button, so Save/Cancel never opens a profile or moves a branch. The repeated Head line is shown only when a custom organization label makes that identity useful. Inline member counts and compact recorded work supply the remaining overview context.

The overview avatar opens the head's profile through the ChatPeople provider supplied by Org, preserving the clicked trigger for focus restoration. Keep that provider when embedding the chart.
Why: PersonAvatar becomes decorative without its provider. Removing the repeated Head button must preserve an accessible profile action rather than only remove text.

Add person stays visible in every card footer, disabled by the managing-role/awake guards with a reason title. Visibility never grants permission.
Why: a missing action looked inconsistent across equal cards; a disabled action explains the actual limit without allowing an unavailable head to recruit.
Coupled: apps/agent-world/web/workplace-names.ts, apps/agent-world/web/workplace-org-name.tsx, apps/agent-world/web/workplace-org-chart.css, apps/agent-world/web/workplace-org.tsx, apps/agent-world/web/workplace-people.tsx
Verify: apps/agent-world/tests/world-org.test.ts

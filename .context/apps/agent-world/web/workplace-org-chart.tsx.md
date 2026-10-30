## symbol:OrgChart

The focused desktop team navigator uses the shared Org team navigator width handle. The existing <=1100px stacked layout hides this separator and leaves its saved desktop size untouched. Chart pan/pinch and graph geometry remain separate from outer grid sizing.
Coupled: apps/agent-world/web/workplace-resize.tsx

The operator rejected horizontal navigation across all independent hierarchies, then found the intermediate vertical outline less intuitive for dragging. The default is a responsive card overview for actual teams (roots with more than one current lasting member, including people at home), followed by a People directory containing every current lasting person. Singleton roots are represented in that list rather than as cards. Opening a team shows a conventional top-down chart fitted to that team's viewport. Zoom and pan stay local to that tree. Team navigation doubles as cross-tree drop targets. The Reports to selector proposes a change through the same confirmation path as drag/drop; it is not a second immediate mutation route.

The overview-only People table aligns identity, role, compact status and actual multi-person team (or Independent). Its name button calls the existing select handler with the exact trigger; Message uses the ordinary DM callback. Each row and card head expose the same visible PersonActionsButton, while team names retain work/Rename and chart cards retain their context actions. Drag/drop handlers stay on directory rows, preserving branch moves for independent people. The table introduces no profile/read state and uses only supplied snapshot metadata; full work content still requires explicit history actions.
Why: the operator requested a full directory, not only a list of singleton organizations. Reusing the existing side panel and lifecycle owner prevents ambiguous parallel selection, hidden-only management and accidental reads.

The caller supplies only lasting people using authoritative temporary metadata, not role/title/name guesses. A missing visible parent makes a person an independent visible root. Team choices use stable session IDs, not status, so a status change does not rearrange navigation.

Avatar tiles have explicit square dimensions and a nonshrinking flex basis. The original fixed-width cards squeezed shared avatar spans; state and fit tests did not establish a usable overview. Keep rendered square-avatar, parent/sibling geometry and fitted horizontal-overflow checks at representative widths. Task context comes from recorded team work, distinct from the current members' work histories; it is not inferred from the reporting tree.

Chromium trackpad pinch arrives as ctrl+wheel. The focused chart owns a nonpassive native wheel listener while ordinary wheel scrolling stays native. Pointer anchoring captures graph coordinates before scaling and restores them through scroll offsets after layout; normal scroll edges can constrain that anchor when content fits. Pinch rejects nonpositive or nonfinite scales without adding range limits; the existing toolbar zoom range is unchanged.
Why: a passive wheel listener cannot prevent document zoom. Restoring scroll before React applies the new canvas dimensions anchors against the old geometry and moves the point under the pointer.

Overview/focused titles use local organization display preferences; person names and stable IDs remain unchanged. Each actual organization's name is the native button that opens its existing WorkHistory modal; the selected organization's h2 uses the same control. Open team still opens the chart and the avatar still opens a profile. Workspace aggregate and profile names have no automatic organization-work callback. Card name editing is outside the person-profile button, so Save/Cancel never opens a profile or moves a branch. The repeated Head line is shown only when a custom organization label makes that identity useful.

WorkHistory's render callback places the name trigger beside the avatar and its summary below the member counts without another state owner. The summary remains a direct child of the overview card, while the focused header retains its work-summary wrapper.
Why: direct-card CSS selectors supply flexible summary height and the two-line preview clamp. Adding a layout wrapper around the callback output would bypass those selectors and can break footer alignment.

The overview avatar opens the head's profile through the ChatPeople provider supplied by Org, preserving the clicked trigger for focus restoration. Keep that provider when embedding the chart.
Why: PersonAvatar becomes decorative without its provider. Removing the repeated Head button must preserve an accessible profile action rather than only remove text.

Actual people in the focused tree have right-click lifecycle actions on the branch card and Shift+F10/ContextMenu on the primary profile button. Shared menu opening prevents profile selection and reads; normal click/drag/report toggling remains unchanged. Organization overview names keep their separate work/Rename actions; their avatar's ordinary profile route and the visible card-head/people-row buttons expose the same named lifecycle ellipsis. OrgChart therefore needs the surrounding WorkplacePersonActions owner as well as ChatPeople.
Coupled: apps/agent-world/web/workplace-person-actions.tsx
Verify: apps/agent-world/tests/world-lifecycle.test.ts

Add person stays visible in every card footer, disabled by the managing-role/awake guards with a reason title. Visibility never grants permission.
Why: a missing action looked inconsistent across equal cards; a disabled action explains the actual limit without allowing an unavailable head to recruit.
Coupled: apps/agent-world/web/workplace-names.ts, apps/agent-world/web/workplace-org-name.tsx, apps/agent-world/web/workplace-org-chart.css, apps/agent-world/web/workplace-org.tsx, apps/agent-world/web/workplace-people.tsx, apps/agent-world/web/workplace-work-history.tsx
Verify: apps/agent-world/tests/world-org.test.ts

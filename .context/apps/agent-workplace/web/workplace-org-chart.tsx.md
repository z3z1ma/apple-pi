## symbol:OrgChart

Org shows one organization, the current workspace (operator, 2026-11-06: no team cards; the tree in a split with the People directory). The chart is the workspace root's conventional top-down tree, fitted to its viewport, with zoom and pan local to it; the directory sits beside it behind the shared `Org people directory width` handle, and the <=1100px layout stacks them and hides the handle. Selecting a person in either side highlights and scrolls to them in both (`data-person`). Moving a person to another organization uses the Reports to selector, which lists managers in every workspace; drag and drop moves within the tree or to Independent.

The People table aligns identity and role, compact status and the person's manager (Head for the root), with a name/role filter. Its name button (accessible name: the person's name, distinct from the chart's "View profile:" cards) calls the existing select handler with the exact trigger; Message uses the ordinary DM callback; each row exposes the visible PersonActionsButton. Drag/drop handlers stay on directory rows. The table introduces no profile/read state and uses only supplied snapshot metadata; full work content still requires explicit history actions.
Why: reusing the existing side panel and lifecycle owner prevents ambiguous parallel selection, hidden-only management and accidental reads.

The overview's checkboxes select a separate explicit batch, without changing profile/DM selection. Select all captures current IDs; arrivals remain unchecked. Opening Let go freezes names and the existing projection's coordinator classification (managing role or reports) for the three handoff choices. The retained DepartureDialog is outside the conditional overview and table, so tab/team navigation and roster deletion cannot destroy its request or results. This adds no new profile/read state.
Coupled: apps/agent-workplace/web/workplace-departures.tsx
Verify: apps/agent-workplace/tests/world-lifecycle.test.ts

The caller supplies only lasting people using authoritative temporary metadata, not role/title/name guesses. A missing visible parent makes a person an independent visible root. Team choices use stable session IDs, not status, so a status change does not rearrange navigation.

Avatar tiles have explicit square dimensions and a nonshrinking flex basis. The original fixed-width cards squeezed shared avatar spans; state and fit tests did not establish a usable overview. Keep rendered square-avatar, parent/sibling geometry and fitted horizontal-overflow checks at representative widths. Task context comes from recorded team work, distinct from the current members' work histories; it is not inferred from the reporting tree.

Chromium trackpad pinch arrives as ctrl+wheel. The focused chart owns a nonpassive native wheel listener while ordinary wheel scrolling stays native. Pointer anchoring captures graph coordinates before scaling and restores them through scroll offsets after layout; normal scroll edges can constrain that anchor when content fits. Pinch rejects nonpositive or nonfinite scales without adding range limits; the existing toolbar zoom range is unchanged.
Why: a passive wheel listener cannot prevent document zoom. Restoring scroll before React applies the new canvas dimensions anchors against the old geometry and moves the point under the pointer.

The organization's name and work summary live in Org's toolbar (the name is the native button that opens its WorkHistory modal, with Rename on its context menu); the chart header holds only the reporting-line tools. Add person appears there only for an awake managing head.

Actual people in the tree have right-click lifecycle actions on the branch card and Shift+F10/ContextMenu on the primary profile button. Shared menu opening prevents profile selection and reads; normal click/drag/report toggling remains unchanged. OrgChart needs the surrounding WorkplacePersonActions owner as well as ChatPeople.
Coupled: apps/agent-workplace/web/workplace-person-actions.tsx
Verify: apps/agent-workplace/tests/world-lifecycle.test.ts
Coupled: apps/agent-workplace/web/workplace-names.ts, apps/agent-workplace/web/workplace-org-name.tsx, apps/agent-workplace/web/workplace-org-chart.css, apps/agent-workplace/web/workplace-org.tsx, apps/agent-workplace/web/workplace-people.tsx, apps/agent-workplace/web/workplace-work-history.tsx
Verify: apps/agent-workplace/tests/world-org.test.ts

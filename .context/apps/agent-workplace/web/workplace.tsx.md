## file

Preference persistence is best-effort; an unavailable storage backend leaves the choice active in this window.
Why: a blocked browser preference store must not prevent an in-window appearance change.

Chat and Mail keep shared usePaneResize state in these retained shells. The standalone profile receives Chat's handle rather than owning width inside its on-demand reader. Sidebar lifecycle actions use right-click on DM/VIP rows and sleeping buttons, with Shift+F10/ContextMenu on the native name buttons. Sidebar rows have no visible ellipsis buttons: the operator rejected their repeated visual weight. Row context opening preserves selection and uses the existing shared person-menu owner; keyboard closing returns to the name button. The name-adjacent Working image uses only awake facts.status=working, excluding home rows; it changes neither presence/unread state nor conversation selection.
Why: a person menu belongs to the row's person, not the selected conversation; inspecting and cancelling another person's action must preserve the active reader and draft. Home-history status must stay readable in both VIP and ordinary sleeping rows: Unicode escapes are interpreted inside JavaScript strings, but print literally in raw JSX text.
Coupled: apps/agent-workplace/web/workplace-resize.tsx, apps/agent-workplace/web/workplace-person-actions.tsx
Verify: apps/agent-workplace/tests/world-org.test.ts

RailApps measures the rail's app area with a ResizeObserver and shows as many apps as fit, in their fixed order; the rest go under one More button that opens the shared workplace menu. When the active app is hidden, More shows that app's icon and label and is pressed; its badge sums the hidden apps' badges. Git and Reviews, like Code, mount on first visit and stay mounted while hidden. The Reviews badge comes from useReviewUpdates, which the shell owns so it polls before Reviews is first opened; `openReview` lets Code's inline review threads switch to Reviews with that review selected. The rail's app gap is 8px so all seven apps fit a 900px-high window; at 16px Reviews fell under More there.
Why: the operator asked for each major tool to become its own app; the rail cannot fit them all on short windows, and an app must stay reachable and visibly selected when it does not fit.
Verify: apps/agent-workplace/tests/world-git.test.ts

World is a lazy retained application tab under the permanent rail/header. Its button selects ?workplace=world without full navigation; the World iframe stays mounted after first visit, while Chat/Mail readers follow their existing active-tab gate. The decorative brand is not a second full-navigation route. Code drafts, live PTYs and planned teams keep their parent component identities across World switches.
Why: World used to be a separate top-level page, which unloaded the editor and triggered terminal cleanup. The existing root beforeunload protection now applies to actual page exit, not switching this tab.
Coupled: apps/agent-workplace/web/workplace-world.tsx, apps/agent-workplace/web/entry.ts
Verify: apps/agent-workplace/tests/world-terminal.test.ts, apps/agent-workplace/tests/world-conversation.test.ts

One stable FileReferenceNavigation callback spans the retained views and profile descendants, clones each explicit target into Code's fileRequest, and selects Code without page navigation or draft/model disposal. DM references use the selected session's cwd; channel/mail bodies use only the exact author's awake/dormant ID lookup, with no cwd guess for operator or unknown authors. Mail remains plain text through FileReferenceText. Resolution/decorating lives in the shared renderer module, and guarded reads/focus/line positioning stay with Code; the shell adds no file-content prefetch.
Coupled: apps/agent-workplace/web/file-references.tsx, apps/agent-workplace/web/workplace-code.tsx, apps/agent-workplace/web/overlay/conversation/transcript.tsx
Verify: apps/agent-workplace/tests/world-file-links.test.ts

One WorkplacePersonActions provider spans the retained views inside wp-surface; profile disappearance or a changed snapshot does not dismiss an issued lifecycle operation. DM-header menus, sidebar context menus and shared profile/card consumers use its single dialog, independent of conversation selection/drafts and the original World iframe actions.
Coupled: apps/agent-workplace/web/workplace-person-actions.tsx, apps/agent-workplace/web/workplace-people.tsx, apps/agent-workplace/web/workplace-org-chart.tsx
Verify: apps/agent-workplace/tests/world-lifecycle.test.ts

The whole wp-surface is inert while world.connected is false, including Code's local controls. Actual Electron interaction fixtures need a connected isolated runtime; a visible input or a preload API alone does not make the form usable. Browser fixtures supply connected snapshots, so their success does not test this prerequisite.

The existing beforeunload guard combines the trusted World's data-world-dirty frame marker, Code's dirty editor and planned teams, and Code's live embedded-terminal count. Chat, Mail and DM drafts no longer hold it: they are kept on the device per conversation (`stored-drafts.ts`), so leaving loses nothing.
Why: the operator was asked to confirm Quit whenever any draft existed. The marker covers the child's separate conversation/inbox draft state even when its frame is hidden. Starting/running terminal sessions count; exited terminal tabs do not. The same native Stay/Leave dialog protects unsaved state and running shells, while ordinary application-tab switching retains the mounted Code/terminal components. Main owns cleanup after committed full navigation, renderer death and actual window closure; a cancelled navigation must not close shells.
Coupled: apps/agent-workplace/web/workplace-code.tsx, apps/agent-workplace/web/workplace-terminal.tsx, apps/agent-workplace/web/world-drafts.ts, apps/agent-workplace/src/electron/main.ts
Verify: apps/agent-workplace/tests/world-terminal.test.ts, apps/agent-workplace/tests/world-navigation.test.ts

The sidebar's VIPs section is only a placement of ordinary DM rows, not a second roster or launch path. Eligibility uses Org's shared orgPeople/descendants metadata: a visible root qualifies at four total current lasting people including itself, nested reports and people at home. Temporary/former people do not contribute. Missing-parent roots follow the same boundary as the Org chart. Eligible head IDs are omitted from both ordinary awake DM rows/count and the sleeping list/count; smaller organizations retain their normal placement. The same compact row renderer supplies profile/name routing, unread/status detail and selection, with a home-history label when needed. Search still filters person names. Snapshot regrouping never rewrites the selected conversation or draft and issues no reads or lifecycle commands.
Why: the threshold is the operator's explicit choice, not a new configurable policy, and moving a sidebar row must not mount a different conversation reader or fabricate consent to wake a person.
Coupled: apps/agent-workplace/web/workplace-org.tsx, apps/agent-workplace/web/workplace-org-chart.tsx
Verify: apps/agent-workplace/tests/world-lifecycle.test.ts

Chat and Mail are keyed by the workspace id, so switching workspaces remounts them: no reader, discovered channel or selection from another organization stays mounted (or marks itself read); drafts live in their own stores. Org is not keyed, because it holds memory-only team plans. Links into a scoped view from global apps (Code's Open in Reviews, Issues' DMs) first switch to the workspace holding that review's people or that person. The switcher reads the current organization's lifetime (`organizationLifetime`, query-only) on every snapshot and after an incorporation, and shows Incorporated, Incorporate this organization, or the people a dissolution waits on; a failed read shows nothing rather than guessing. An incorporation's result and error belong to the root it was started for: a refresh applies only while that workspace is still shown, and errors are kept per root, so one workspace's late result neither shows in nor erases another's. The switcher's last item, Leave <organization>, opens the shared DepartureDialog for every lasting member with no handoffs preselected; its pending work joins the leave guard.
Why: the shell stays mounted across workspace switches, so a late incorporation result once replaced another workspace's status and showed its error there (review review-5b5a62a2).
Verify: apps/agent-workplace/tests/world-lifecycle.test.ts

The brand mark at the top of the rail is the workspace switcher: it shows the current organization's initials and opens a menu of every workspace with its unread count (`workplace-workspaces.ts`). The top bar and Chat's sidebar heading name the current organization; the sidebar heading is that root's organization name editor, and falls back to the reserved device-local `workspace` preference only when there is no organization. Chat labels resolve organization:<head> to org- and team:<head> to team- slugs from per-head UI names; channel selection/read/cursors still use the original ID. Passing only channelLabel into ThreadPane keeps a rename from becoming a new channel read. Name changes rerender through the shared local preference subscription. The root mounts exactly one WorkplaceMenuProvider. Right-click or keyboard context actions on organization/team channel rows open a local name form without selecting or reading the channel; the target key is the parsed head ID, never the display slug. Channel heading context action shares that path; row buttons remain its keyboard entry. Closing the form restores a still-connected trigger.
Coupled: apps/agent-workplace/web/workplace-names.ts, apps/agent-workplace/web/workplace-org-name.tsx

The DM header uses a compact run-state label plus role, not the detailed tool activity used by other views. Current tool details belong only in the lower activity line, which must ellipsize to available space. Keep the shared `activity()` helper detailed for its other consumers. Compact status is shared with profiles through `workplace-people.tsx`.
Why: a long tool argument replaced the short status and made the header unstable. The lower activity line can show useful live detail without stretching the header or borrowing stale tool metadata.
Coupled: apps/agent-workplace/web/overlay/conversation/conversation-panel.tsx, apps/agent-workplace/web/workplace.css
Verify: apps/agent-workplace/tests/world-conversation.test.ts

Names open the known sender's DM by ID; avatars open the observational profile, whose full Self is loaded on demand. Keep those controls separate in sidebar rows rather than nesting buttons. DM navigation uses the same selection path and preserves drafts; profiles use the precise clicked avatar as their return-focus target even when replacing an already-open profile.
Coupled: apps/agent-workplace/web/workplace-people.tsx
Verify: apps/agent-workplace/tests/world-conversation.test.ts

Keep the Chat and Mail shells mounted to retain selection, but mount their keyed workplace-thread readers only while that application is visible. Unsent bodies remain in this shell's shared draft map; selected notification targets and uncertain attempt identities belong to the communication reader's renderer-lifetime state. Discovery stores metadata for an explicitly opened channel even before it is followed; followed topics later arrive in the ordinary snapshot. No channel is joined or read just because discovery lists it.
Why: session readers mark results seen and watch live replies, and a visible channel reader marks what it shows read. Hidden readers must not chain fresh reads after accepted operations complete. A newly selected thread owns fresh request state; changed snapshot object identity is not a new opening.
Coupled: apps/agent-workplace/web/workplace-thread.tsx, apps/agent-workplace/web/workplace-channels.tsx, apps/agent-workplace/web/overlay/conversation/conversation-panel.tsx, apps/agent-workplace/web/overlay/conversation/live-reply.ts
Verify: apps/agent-workplace/scripts/workplace-smoke.mjs

Unread channel counts come from the operator inbox summaries matched by thread ID, while DM dots reflect the existing runtime update flag. The Chat rail counts unread conversations; Mail counts unread messages, with channel threads kept in Chat rather than duplicated in its Inbox. Descriptions name these units. A channel's New messages boundary uses the returned pre-read cursor, not arithmetic on its unread count.
While focused and following the latest channel posts, a changed last sequence triggers one recent inspection, and the reader marks what it shows read (`markRead`), as Slack does. Reading older content or losing focus leaves later posts unread behind an explicit jump; one failed read per observed sequence stays actionable without a retry loop. Range, pin inspection and search mark nothing.
Coupled: apps/agent-workplace/src/backend/mail.ts, apps/agent-workplace/web/use-window-focus.ts
Verify: apps/agent-workplace/tests/world-conversation.test.ts, apps/agent-workplace/tests/channel-membership.test.ts

Activity is the display name of the existing organization delivery log in both navigation and the selected list heading; the internal traffic key and read-only delivery ownership stay unchanged.
Why: renaming only the navigation button left the destination with the old name, which a button-only test missed.
Verify: apps/agent-workplace/tests/world-conversation.test.ts

Chat channels and Mail threads use the typed communications API through workplace-thread. Returned permissions govern controls; channel access permits posting without following. Join/Leave changes following, not read position or organization-derived access. Explicit notify targets alone request channel attention; prose names remain text. Mail retains addressed delivery. Archived ordinary conversations expose participant-controlled reopening; structural/work lifecycle restrictions remain runtime permissions.
Why: access, following, attention and catch-up are separate effects. Delivery records are not complete conversations and cannot safely supply a reply target. Native and human posts must share the same explicit-notification protocol rather than silently invoking the old name-matching post path.
Coupled: apps/agent-workplace/web/workplace-thread.tsx, apps/agent-workplace/src/communications.ts, apps/agent-workplace/src/backend/communications.ts
Verify: apps/agent-workplace/scripts/workplace-smoke.mjs

Mail lives in workplace-mail.tsx; the shell passes it the shared draft map.

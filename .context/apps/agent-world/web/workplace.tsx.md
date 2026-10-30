## file

Chat and Mail keep shared usePaneResize state in these retained shells. The standalone profile receives Chat's handle rather than owning width inside its on-demand reader. Sidebar lifecycle actions use right-click on DM/VIP rows and sleeping buttons, with Shift+F10/ContextMenu on the native name buttons. The rail has no visible ellipsis buttons: the operator rejected their repeated visual weight. Row context opening preserves selection and uses the existing shared person-menu owner; keyboard closing returns to the name button. The name-adjacent Working image uses only awake facts.status=working, excluding home rows; it changes neither presence/unread state nor conversation selection.
Why: a person menu belongs to the row's person, not the selected conversation; inspecting and cancelling another person's action must preserve the active reader and draft. Home-history status must stay readable in both VIP and ordinary sleeping rows: Unicode escapes are interpreted inside JavaScript strings, but print literally in raw JSX text.
Coupled: apps/agent-world/web/workplace-resize.tsx, apps/agent-world/web/workplace-person-actions.tsx
Verify: apps/agent-world/tests/world-org.test.ts

World is a lazy retained application tab under the permanent rail/header. Its button selects ?workplace=world without full navigation; the World iframe stays mounted after first visit, while Chat/Mail readers follow their existing active-tab gate. The decorative brand is not a second full-navigation route. Code drafts, live PTYs and planned teams keep their parent component identities across World switches.
Why: World used to be a separate top-level page, which unloaded the editor and triggered terminal cleanup. The existing root beforeunload protection now applies to actual page exit, not switching this tab.
Coupled: apps/agent-world/web/workplace-world.tsx, apps/agent-world/web/entry.ts
Verify: apps/agent-world/tests/world-terminal.test.ts, apps/agent-world/tests/world-conversation.test.ts

One stable FileReferenceNavigation callback spans the retained views and profile descendants, clones each explicit target into Code's fileRequest, and selects Code without page navigation or draft/model disposal. DM references use the selected session's cwd; channel/mail bodies use only the exact author's awake/dormant ID lookup, with no cwd guess for operator or unknown authors. Mail remains plain text through FileReferenceText. Resolution/decorating lives in the shared renderer module, and guarded reads/focus/line positioning stay with Code; the shell adds no file-content prefetch.
Coupled: apps/agent-world/web/file-references.tsx, apps/agent-world/web/workplace-code.tsx, apps/agent-world/web/overlay/conversation/transcript.tsx
Verify: apps/agent-world/tests/world-file-links.test.ts

One WorkplacePersonActions provider spans the retained views inside wp-surface; profile disappearance or a changed snapshot does not dismiss an issued lifecycle operation. DM-header menus, sidebar context menus and shared profile/card consumers use its single dialog, independent of conversation selection/drafts and the original World iframe actions.
Coupled: apps/agent-world/web/workplace-person-actions.tsx, apps/agent-world/web/workplace-people.tsx, apps/agent-world/web/workplace-org-chart.tsx
Verify: apps/agent-world/tests/world-lifecycle.test.ts

The whole wp-surface is inert while world.connected is false, including Code's local controls. Actual Electron interaction fixtures need a connected isolated runtime; a visible input or a preload API alone does not make the form usable. Browser fixtures supply connected snapshots, so their success does not test this prerequisite.

The existing beforeunload guard combines unsaved parent drafts, the trusted World's data-world-dirty frame marker, and Code's live embedded-terminal count. The marker covers the child's separate conversation/inbox draft state even when its frame is hidden. Starting/running terminal sessions count; exited terminal tabs do not. The same native Stay/Leave dialog protects unsaved state and running shells, while ordinary application-tab switching retains the mounted Code/terminal components. Main owns cleanup after committed full navigation, renderer death and actual window closure; a cancelled navigation must not close shells.
Coupled: apps/agent-world/web/workplace-code.tsx, apps/agent-world/web/workplace-terminal.tsx, apps/agent-world/web/world-drafts.ts, apps/agent-world/src/electron/main.ts
Verify: apps/agent-world/tests/world-terminal.test.ts, apps/agent-world/tests/world-navigation.test.ts

The sidebar's VIPs section is only a placement of ordinary DM rows, not a second roster or launch path. Eligibility uses Org's shared orgPeople/descendants metadata: a visible root qualifies at four total current lasting people including itself, nested reports and people at home. Temporary/former people do not contribute. Missing-parent roots follow the same boundary as the Org chart. Eligible head IDs are omitted from both ordinary awake DM rows/count and the sleeping list/count; smaller organizations retain their normal placement. The same compact row renderer supplies profile/name routing, unread/status detail and selection, with a home-history label when needed. Search still filters person names. Snapshot regrouping never rewrites the selected conversation or draft and issues no reads or lifecycle commands.
Why: the threshold is the operator's explicit choice, not a new configurable policy, and moving a sidebar row must not mount a different conversation reader or fabricate consent to wake a person.
Coupled: apps/agent-world/web/workplace-org.tsx, apps/agent-world/web/workplace-org-chart.tsx
Verify: apps/agent-world/tests/world-lifecycle.test.ts

Workspace heading uses the reserved device-local workspace display preference, independent of any session identity. Chat labels resolve organization:<head> to org- and team:<head> to team- slugs from per-head UI names; channel selection/read/cursors still use the original ID. Passing only channelLabel into ThreadPane keeps a rename from becoming a new channel read. Name changes rerender through the shared local preference subscription. The root mounts exactly one WorkplaceMenuProvider. Right-click or keyboard context actions on organization/team channel rows open a local name form without selecting or reading the channel; the target key is the parsed head ID, never the display slug. Channel heading context action shares that path; row buttons remain its keyboard entry. Closing the form restores a still-connected trigger.
Coupled: apps/agent-world/web/workplace-names.ts, apps/agent-world/web/workplace-org-name.tsx

The DM header uses a compact run-state label plus role, not the detailed tool activity used by other views. Current tool details belong only in the lower activity line, which must ellipsize to available space. Keep the shared `activity()` helper detailed for its other consumers. Compact status is shared with profiles through `workplace-people.tsx`.
Why: a long tool argument replaced the short status and made the header unstable. The lower activity line can show useful live detail without stretching the header or borrowing stale tool metadata.
Coupled: apps/agent-world/web/overlay/conversation/conversation-panel.tsx, apps/agent-world/web/workplace.css
Verify: apps/agent-world/tests/world-conversation.test.ts

Names open the known sender's DM by ID; avatars open the observational profile, whose full Self is loaded on demand. Keep those controls separate in sidebar rows rather than nesting buttons. DM navigation uses the same selection path and preserves drafts; profiles use the precise clicked avatar as their return-focus target even when replacing an already-open profile.
Coupled: apps/agent-world/web/workplace-people.tsx
Verify: apps/agent-world/tests/world-conversation.test.ts

Keep the Chat and Mail shells mounted to retain selection, but mount their keyed workplace-thread readers only while that application is visible. Unsent bodies remain in this shell's shared draft map; selected notification targets and uncertain attempt identities belong to the communication reader's renderer-lifetime state. Discovery stores metadata for an explicitly opened channel even before it is followed; followed topics later arrive in the ordinary snapshot. No channel is joined or read just because discovery lists it.
Why: session readers mark results seen and watch live replies, while explicit communication Catch up advances a returned page only. Hidden readers must not chain fresh reads after accepted operations complete. A newly selected thread owns fresh request state; changed snapshot object identity is not a new opening.
Coupled: apps/agent-world/web/workplace-thread.tsx, apps/agent-world/web/workplace-channels.tsx, apps/agent-world/web/overlay/conversation/conversation-panel.tsx, apps/agent-world/web/overlay/conversation/live-reply.ts
Verify: apps/agent-world/scripts/workplace-smoke.mjs

Unread channel counts come from the operator inbox summaries matched by thread ID, while DM dots reflect the existing runtime update flag. The Chat rail counts unread conversations; Mail counts unread messages, with channel threads kept in Chat rather than duplicated in its Inbox. Descriptions name these units. A channel's New messages boundary uses the returned pre-read cursor, not arithmetic on its unread count.
While focused and following the latest channel posts, a changed last sequence triggers one recent inspection, without acknowledgment. Reading older content or losing focus leaves later posts waiting behind an explicit jump; one failed read per observed sequence stays actionable without a retry loop. The explicit Catch up action alone acknowledges its returned page; recent, range, pin inspection and search preserve catch-up.
Coupled: apps/agent-world/src/backend/mail.ts, apps/agent-world/web/use-window-focus.ts
Verify: apps/agent-world/tests/world-conversation.test.ts, apps/agent-world/tests/channel-membership.test.ts

Activity is the display name of the existing organization delivery log in both navigation and the selected list heading; the internal traffic key and read-only delivery ownership stay unchanged.
Why: renaming only the navigation button left the destination with the old name, which a button-only test missed.
Verify: apps/agent-world/tests/world-conversation.test.ts

Chat channels and Mail threads use the typed communications API through workplace-thread. Returned permissions govern controls; channel access permits posting without following. Join/Leave changes following, not read position or organization-derived access. Explicit notify targets alone request channel attention; prose names remain text. Mail retains addressed delivery. Archived ordinary conversations expose participant-controlled reopening; structural/work lifecycle restrictions remain runtime permissions.
Why: access, following, attention and catch-up are separate effects. Delivery records are not complete conversations and cannot safely supply a reply target. Native and human posts must share the same explicit-notification protocol rather than silently invoking the old name-matching post path.
Coupled: apps/agent-world/web/workplace-thread.tsx, apps/agent-world/src/communications.ts, apps/agent-world/src/backend/communications.ts
Verify: apps/agent-world/scripts/workplace-smoke.mjs

## symbol:Compose

The existing single-recipient, fixed-subject form submits through communications.sendMail with a renderer-allocated attempt UUID retained before the request. Its canonical recipient/body survive uncertain outcomes and closing/reopening the form. Outcome recovery uses the same UUID; it never constructs another thread. A fresh send after not_recorded requires explicit duplicate-risk acknowledgment and preserves the draft without sending it automatically. Applied results clear only the matching saved body and report actual audience/queued state separately from acknowledgment. Legacy World sendMail remains a separate consumer and is intentionally unchanged here.
Coupled: apps/agent-world/src/communications.ts, apps/agent-world/src/backend/communications.ts
Verify: apps/agent-world/tests/world-communications.test.ts

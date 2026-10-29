## file

Workspace heading uses the reserved device-local workspace display preference, independent of any session identity. Chat labels resolve organization:<head> to org- and team:<head> to team- slugs from per-head UI names; channel selection/read/cursors still use the original ID. Passing only channelLabel into ThreadPane keeps a rename from becoming a new channel read. Name changes rerender through the shared local preference subscription. The root mounts exactly one WorkplaceMenuProvider. Right-click or keyboard context actions on organization/team channel rows open a local name form without selecting or reading the channel; the target key is the parsed head ID, never the display slug. Channel heading context action shares that path; row buttons remain its keyboard entry. Closing the form restores a still-connected trigger.
Coupled: apps/agent-world/web/workplace-names.ts, apps/agent-world/web/workplace-org-name.tsx

The DM header uses a compact run-state label plus role, not the detailed tool activity used by other views. Current tool details belong only in the lower activity line, which must ellipsize to available space. Keep the shared `activity()` helper detailed for its other consumers. Compact status is shared with profiles through `workplace-people.tsx`.
Why: a long tool argument replaced the short status and made the header unstable. The lower activity line can show useful live detail without stretching the header or borrowing stale tool metadata.
Coupled: apps/agent-world/web/overlay/conversation/conversation-panel.tsx, apps/agent-world/web/workplace.css
Verify: apps/agent-world/tests/world-conversation.test.ts

Names open the known sender's DM by ID; avatars open the observational profile, whose full Self is loaded on demand. Keep those controls separate in sidebar rows rather than nesting buttons. DM navigation uses the same selection path and preserves drafts; profiles use the precise clicked avatar as their return-focus target even when replacing an already-open profile.
Coupled: apps/agent-world/web/workplace-people.tsx
Verify: apps/agent-world/tests/world-conversation.test.ts

Keep the Chat and Mail shells mounted to retain selection, but mount their readers only while that application is visible. Key each thread reader by its id; request completions belong to that instance, while unsent message bodies outlive it in memory. The opening read runs once per key; later channel updates use the focused follow-latest gate rather than rerunning the mount effect for a changed channel object.
Why: inbox reads advance the operator's cursor, and session readers mark results seen and watch live replies. CSS visibility alone would leave those effects running for a hidden conversation. A newly selected thread must also get fresh request state rather than accepting a previous thread's late response. Snapshots replace channel objects even on unrelated updates; treating that identity change as another opening read would acknowledge posts while the operator reads older content.
Coupled: apps/agent-world/web/overlay/conversation/conversation-panel.tsx, apps/agent-world/web/overlay/conversation/live-reply.ts, apps/agent-world/src/backend/mail.ts
Verify: apps/agent-world/scripts/workplace-smoke.mjs

Unread channel counts come from the operator inbox summaries matched by thread ID, while DM dots reflect the existing runtime update flag. The Chat rail counts unread conversations; Mail counts unread messages, with channel threads kept in Chat rather than duplicated in its Inbox. Descriptions name these units. A channel's New messages boundary uses the returned pre-read cursor, not arithmetic on its unread count.
While focused and following the latest channel posts, a changed last sequence triggers one read. Reading older content or losing focus leaves later posts waiting behind an explicit jump; one failed read per observed sequence stays actionable without a retry loop. Each reader still acknowledges only its returned history through the existing API.
Coupled: apps/agent-world/src/backend/mail.ts, apps/agent-world/web/use-window-focus.ts
Verify: apps/agent-world/tests/world-conversation.test.ts, apps/agent-world/tests/channel-membership.test.ts

Activity is the display name of the existing organization delivery log in both navigation and the selected list heading; the internal traffic key and read-only delivery ownership stay unchanged.
Why: renaming only the navigation button left the destination with the old name, which a button-only test missed.
Verify: apps/agent-world/tests/world-conversation.test.ts

Channel observation uses the shared-workplace reader; mail uses the participant-only inbox reader. Replies remain ordinary runtime thread posts, and the post form appears only for the operator's participation in the returned thread. Join and Leave call the explicit operator membership bridge, then reread after an applied receipt. A failed membership change keeps the existing participation and draft; joining acknowledges only the now-visible returned history through the normal reader.
Why: observing a shared channel is separate from the operator choosing to join it; neither permits advancing someone else's cursor or posting as another person. Delivery records are not complete conversations and cannot safely supply a reply target.
Coupled: apps/agent-world/src/backend/workplace.ts, apps/agent-world/src/backend/mail.ts
Verify: apps/agent-world/scripts/workplace-smoke.mjs

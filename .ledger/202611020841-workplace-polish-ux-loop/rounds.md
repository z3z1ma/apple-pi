# Rounds

Each round names the surface, what was compared, the findings (V = visual, U = interaction) and what changed.

## Round 1: Chat messages (DM, channel, thread panel) against Slack

Captured live with `live-mirror.ts chat` and `actions`.

- U1 No message actions at all: no hover toolbar, no right-click menu, no reply to a specific message, no forward, no copy. **Fixed:** `workplace-message-actions.tsx` gives every DM, channel and thread message a hover toolbar (Reply, Forward, Copy, More) and the same items on right-click. Reply and Forward act on the selected words when there is a selection.
- U2 Replying to a message further up: **Fixed:** Reply shows a "Replying to <author>: <excerpt>" bar over the composer; the quote goes out above the reply (agents see exactly what is answered).
- U3 Forwarding between agents: **Fixed:** Forward opens a picker over people, the front desk, channels and task threads, with an optional note; an awake person gets it in their DM (after their current step when busy), a person at home gets mail, a thread gets a post. A toast reports the outcome with Open.
- V1 Message sequence numbers (`#7450`) and a Pin button sat in every message header. **Fixed:** the sequence moved to the time's tooltip; Pin and Copy reference moved to the message menu.
- V2 Composer key hints were plain text with uneven spacing. **Fixed** in `35470ac7`: keycaps everywhere.

## Round 2: Chat chrome (headers, top bar, sidebar) against Slack

- V3 Channel headers spent a second row on search / Catch up / Read latest / Actions. **Fixed:** they sit in the header row. The thread side panel keeps its row (its title wraps).
- V4 The top bar was only a breadcrumb. **Fixed:** a centred "Jump to a person, channel or thread  ⌘K" field opens the switcher from any tab.
- V5 Sidebar header took three lines. **Fixed:** organization name plus "N working · M awake".
- V6 Section counts and group member counts read like unread badges. **Fixed:** a section shows its count only when collapsed; member counts moved to the tooltip; only unread is a number.
- V7 Preview bar wording was internal and Join was plain text. **Fixed:** "You are viewing <place>. Join to see its new posts in your unread counts." with a primary Join button; teams read as "<Name>'s team", not a slug.

## UX backlog (ranked by attention saved per operator action)

1. Drafts survive reload and show a pencil in the sidebar; mark all read; Alt+Up/Down between conversations; Esc marks read.
2. @mention autocomplete in channel composers, mapped to the notify list (names in prose stay text).
3. Coordinator proactiveness: a standing Slack sweep (mentions and DMs to the operator) triaged into the desk; morning summary.
4. Save for later (bookmarks) and a Later view; remind me about a message.
5. Create a task from a message (assign to a person) without leaving the conversation.
6. Agent status at a glance: what each person is doing now, in the DM header and sidebar hover.
7. Bulk: select several conversations; send one instruction to many agents.

## Round 3: attention and steps across conversations

- U4 Drafts were lost on reload and invisible once you left a conversation; quitting with any draft asked to confirm. **Fixed:** DM and channel/thread/mail drafts are stored on the device per conversation; a pencil marks sidebar rows holding one; drafts no longer hold Quit.
- U5 No way to move between conversations without the mouse. **Fixed:** Alt + Up/Down walks the sidebar; Alt + Shift + Up/Down only stops at unread ones (Slack's keys).
- U6 No mark-all-read. **Fixed:** Shift + Escape (and a button in Activity) marks every unseen DM seen and catches every unread channel up.

## Round 4: front desk proactiveness

- U7 The coordinator only reacted to what the operator typed into the desk; Slack messages to him and PR activity reached nobody unless he relayed them. **Changed:** `roles/coordinator.md` now keeps standing schedules (a Slack sweep every 15 minutes that triages DMs, mentions and his threads into the desk, tasks or drafted replies, and a daily morning brief) and watches his repositories and in-flight external threads. It never sends Slack messages as him. Takes effect when the coordinator session next starts or reloads; unproven live.

## Round 5: addressing people from a channel

- U8 Names in a channel post were only text; asking someone's attention meant opening a Notify picker. **Fixed:** typing @ in a channel or the desk lists people; Enter or Tab inserts the name and the post notifies everyone still @mentioned (prose names stay text).
- U9 Turning any message into work took copying it to the desk by hand. **Fixed:** "Ask the front desk to handle" on every message posts it to the desk, quoted, and notifies the coordinator; one click.
- V8 Quoted messages ran the author line into the first quoted line. **Fixed:** the quote's header is its own paragraph.

Open: the desk keeps a separate row for search / Catch up / Read latest / Actions under the in-flight strip.

## Round 6: one header row everywhere

- V9 The desk and the thread side panel still spent a row on reading controls, and the channel fix positioned them absolutely. **Fixed at the shared cause:** `ThreadPane` takes a `toolbarHost` and portals search / Catch up / Read latest / Actions into its host's header (channel header, desk header beside Listening, thread panel under its title); the absolute-position rule is gone.
- V10 Threads filter counts wrapped onto a second line when the side panel narrowed the list. **Fixed:** segment labels stay on one line.

## Round 7: Mail against Superhuman / Gmail

- M1 The inbox was mostly "Departure: …" notices from Pi, burying mail from people. **Fixed:** a People / Updates split (Superhuman's split inbox) in the list title row, each with its unread count.
- M2 The Activity folder showed a heavy "211" badge for a delivery log nobody clears. **Fixed:** a quiet count.
- M3 The reader spent a row on reading controls. **Fixed:** they sit beside the subject (the shared header slot).
- M4 At 1100 px the list overflowed: rows clipped their times and subjects without ellipsis. **Fixed:** the row's text column cannot grow past the pane; subjects ellipsize; the search field no longer collapses.

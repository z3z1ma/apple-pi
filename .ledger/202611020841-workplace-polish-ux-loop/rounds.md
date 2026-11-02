# Rounds

Each round names the surface, what was compared, the findings (V = visual, U = interaction) and what changed.

## Round 1: Chat messages (DM, channel, thread panel) against Slack

Captured live with `live-mirror.ts chat` and `actions`.

- U1 No message actions at all: no hover toolbar, no right-click menu, no reply to a specific message, no forward, no copy. **Fixed:** `workplace-message-actions.tsx` gives every DM, channel and thread message a hover toolbar (Reply, Forward, Copy, More) and the same items on right-click. Reply and Forward act on the selected words when there is a selection.
- U2 Replying to a message further up: **Fixed:** Reply shows a "Replying to <author>: <excerpt>" bar over the composer; the quote goes out above the reply (agents see exactly what is answered).
- U3 Forwarding between agents: **Fixed:** Forward opens a picker over people, the front desk, channels and task threads, with an optional note; an awake person gets it in their DM (after their current step when busy), a person at home gets mail, a thread gets a post. A toast reports the outcome with Open.
- V1 Message sequence numbers (`#7450`) and a Pin button sat in every message header. **Fixed:** the sequence moved to the time's tooltip; Pin and Copy reference moved to the message menu.
- V2 Composer key hints were plain text with uneven spacing. **Fixed** in `35470ac7`: keycaps everywhere.

Open from this round:

- V3 Channel and thread-panel headers spend a second row on search / Catch up / Read latest / Actions; Slack keeps one header row with icon buttons.
- V4 The top bar is a breadcrumb; Slack puts a search field there. Make it open the switcher (and later message search).
- V5 Sidebar header takes three lines (eyebrow, name, "2 active sessions"); Slack uses one line with a compose button.
- V6 Sidebar section counts (Channels 5, Groups 5) and group member counts read like unread badges. Only unread should be a number.
- V7 Channel preview bar: "Join channel" is plain text and the explanation is internal wording.

## UX backlog (ranked by attention saved per operator action)

1. Drafts survive reload and show a pencil in the sidebar; mark all read; Alt+Up/Down between conversations; Esc marks read.
2. @mention autocomplete in channel composers, mapped to the notify list (names in prose stay text).
3. Coordinator proactiveness: a standing Slack sweep (mentions and DMs to the operator) triaged into the desk; morning summary.
4. Save for later (bookmarks) and a Later view; remind me about a message.
5. Create a task from a message (assign to a person) without leaving the conversation.
6. Agent status at a glance: what each person is doing now, in the DM header and sidebar hover.
7. Bulk: select several conversations; send one instruction to many agents.

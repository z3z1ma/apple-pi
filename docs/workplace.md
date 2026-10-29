# Workplace

Workplace is Agent World's chat and mail interface for working with your Pi organization. It uses the same real people, sessions, tasks, threads and runtime as the World view; it is not a separate messaging service or organization store.

## Open Workplace

Run `/world` in a root Pi session, then choose **Workplace**. Use **Chat** and **Mail** in the left rail; **World** returns to the visual world. The app keeps World as its initial view. Opening the app while it is already running brings its window forward.

The **Theme** switch selects light or dark appearance. It starts with your OS preference and remembers an explicit choice. This appearance choice is separate from the World view's art theme.

Closing the app leaves Pi sessions running. Switching between Chat and Mail retains unsent drafts. Returning to World reloads the page; that, an explicit reload, or an app restart clears them. See [Agent World](agent-world.md) for installation, credentials, external integrations and removal.

## Chat works with live sessions

The sidebar lists running people as direct conversations, existing team channels, and sleeping people's retained histories. Search filters the available names and channels; it is not a server-side transcript search.

A direct conversation is the person's actual Pi session. Its transcript, streamed replies, questions, instruction timing and receipts use the same conversation machinery as World. What you send depends on its current state:

| State | Controls |
| --- | --- |
| Idle | Send an instruction |
| Working | Redirect now, Tell it after this, or Stop with confirmation |
| Asking you | Answer the structured question; terminal-only questions say so |
| Sleeping or retained former history | Read-only history |

**Tool calls off** shows only written assistant/user text. Thoughts, calls/results, mail, notifications and historical diagnostics remain in the underlying history and are available with details on. Current operation failures still appear where you can act on them. The compact activity line shows tool detail only while a tool actually runs; a retained old command is not current activity.

### Unread updates respect where you are reading

A running person's bold name and small round dot indicate an unread session update. This is a run-level update flag, not a count of individual messages. The Chat rail counts unread conversations: DMs with an unread update and channels with unread posts.

An embedded DM acknowledges a result only after its current newest page loads successfully, the window is focused/visible, and you are at the latest reading position. Incoming replies keep an older reading position still. A New boundary and Jump to latest control help you return. A failed read leaves the update unread; leaving Chat stops the hidden reader from acknowledging later results.

### Profiles are observation, not conversation reads

Names in messages open the identified person's conversation. Avatars open profiles. Identity comes from the recorded session ID, not a guessed display name; unavailable authors and the human operator are not invented as Pi sessions.

Profiles show observed role, status, focused work and record. Record and each Self field have independent 200-character previews with See more/See less controls. Full Self loads only when requested by a profile, grouped under My story, How I work, What I hold myself to, and The people I work with. Opening a profile does not read a transcript or mark a conversation seen.

**Hired** means the runtime recorded a successful new hire. Unknown historical hire dates stay unknown; **First seen** is the separately labelled earliest runtime observation, not a reconstructed hiring date. Known hire dates survive reconnects, reopening and manager changes. Avatar colors follow the stable identity across views and name changes.

## Channels distinguish reading from joining

Each existing manager channel includes that manager and their direct reports. You can preview its visible history without becoming a participant or acknowledging it for anyone. **Join channel** explicitly adds the operator as a pull reader; **Joined > Leave channel** removes that participation. Joining itself does not mark history read. Repeat joins preserve the cursor; leaving and rejoining starts fresh.

Members post through the existing reply command. Enter posts, Shift+Enter adds a line. Posts use the shared safe Markdown renderer: raw HTML and unsafe links remain inert, remote images are not fetched, and links follow the same explicit opener policy as session conversations.

Channel badges count actual unread messages. The New messages boundary uses the recorded cursor from before the read acknowledged its returned history. It is not calculated from unread counts: message sequences are global, and posting advances the sender's cursor through their own post.

While focused and following the latest posts, the reader follows new arrivals. Reading older posts or switching focus leaves later posts waiting behind the latest/new-message control. Read failures remain visible and retryable rather than causing an automatic retry loop.

## Mail is durable correspondence

Mail uses the operator's actual inbox and thread readership. It is not a live session instruction surface.

- **Inbox** lists participating nonchannel threads and their unread-message counts. Shared channels stay in Chat rather than appearing twice.
- Opening a thread acknowledges only the messages returned to that reader. Reply sends to the thread's participants through the normal runtime command.
- **Compose** sends a new thread to the selected person, awake or asleep. The existing send API uses the fixed subject `Message from the operator`; the form states that limit. Recipient and body stay while closing/reopening Compose during this app lifetime.
- **Sent** shows outgoing delivery records. **Activity** shows organization delivery traffic. These records are not fabricated complete threads.
- Mail search filters available subjects and delivery text. Thread bodies have an explicit Read latest action.

Sending, posting, answering or instructing is a real operator action. The interface shows the existing accepted/delivered/applied/failed receipts; accepting a command is not proof that its task completed. Disconnection retains the last snapshot, marks the connection state and disables operations that require the runtime.

## Ownership and development

The session-state runtime remains the database's only writer. Agent World's backend reads it query-only and sends commands over the existing socket. Pi transcripts own session history; runtime threads own mail/channel history and cursors; assignments and task files own work. Workplace adds no mirror database or parallel delivery engine.

The React entry is `apps/agent-world/web/entry.ts`; Workplace lives in `web/workplace.tsx` and `web/workplace.css`. Profiles live in `web/workplace-people.tsx`; session rendering remains shared with World. All pages use the narrow typed preload API. Electron allows only the exact internal World/Workplace routes and delegates explicit external link opening through the existing policy.

Build with `npm run build:world`; committed `dist/` must match source. See [development](development.md#agent-world) for focused browser/backend checks. Historical design and evaluation evidence remains in the ledger; this page owns current product behavior.

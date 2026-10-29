# Workplace

Workplace is Agent World's organization, chat and mail interface for working with your Pi organization. It uses the same real people, sessions, tasks, threads and runtime as the World view; it is not a separate messaging service or organization store.

## Open Workplace

Run `/world` in a root Pi session, then choose **Workplace**. Use **Org**, **Chat** and **Mail** in the left rail; **World** returns to the visual world. The app keeps World as its initial view. Opening the app while it is already running brings its window forward.

The **Theme** switch selects light or dark appearance. It starts with your OS preference and remembers an explicit choice. This appearance choice is separate from the World view's art theme.

Closing the app leaves Pi sessions running. Switching among Org, Chat and Mail retains unstarted team plans and unsent message drafts. Returning to World reloads the renderer; that, an explicit reload, or an app restart clears those local drafts. Already prepared people and their work remain real; reopening the app does not restore the discarded team editor.

A renderer reload refreshes the page only. After main-process/backend changes, fully quit and relaunch Agent World to load the new APIs, including work history. Relaunching Agent World leaves Pi sessions running but loses the same memory-only drafts. This is separate from restarting the shared session-state daemon, which requires explicit approval and may stop headless people. See [Agent World](agent-world.md) for installation, credentials, external integrations and removal.

## Org plans teams and changes reporting

Org opens with a responsive overview of independent teams, including people at home. Choose **Open team** to inspect a conventional top-down reporting chart fitted to that team's viewport. **All teams** returns to the overview; the team navigation switches between organizations. Within a team, drag empty chart space to pan, use **Zoom in**, **Zoom out** or **Fit**, and collapse or expand reports. Zoom and pan stay local to the focused chart. Each tree's **head** has no manager; a **branch** is one person and everyone reporting to them, at any depth. **Lasting people** are ordinary Pi sessions, as distinct from temporary peers created for a program. Temporary program peers and departed people stay outside the editable roster. A real person's card opens their existing profile without reading or acknowledging their conversation; a planned position shows catalog role and goal details, not an invented personal history.

### Work gives each team context

Team cards show compact **Recorded team work** summaries: the most recent task title and counts of open, completed and other recorded tasks. **View recorded work** expands the full list. A focused team shows the same compact summary above the chart; expand **View recorded work** when you want its full history. A task's **anchor** is the organization head recorded when that task was registered. Team history groups tasks by that recorded head, not by where their participants report today; moving a person does not rewrite their earlier team's work history.

Profiles show **Recorded work** from that person's actual assignments, including tasks from other organizations, labelled with their recorded organization. Assignment outcomes such as assigned, assignment finished and unassigned remain separate from the task's own status: finishing one person's assignment does not mean the whole task is completed. Empty history and unavailable history have distinct messages. Select a task title to read its task document inside the panel; browsing metadata alone does not read task content, transcripts or channel history. **Close** dismisses the profile.

Use **Search people, teams, and work** across the current snapshot, not only the focused team. People match names, roles, current task and team; work matches recorded task metadata. Results open a profile, switch teams or explicitly **Read task**. This is not a search through conversations or task-document bodies. **Close search results** or Escape closes the results.

### Change reporting without changing work

Drag a branch onto an eligible manager, or open the person's profile and select a manager in **Reports to**. Selecting a different value opens confirmation directly; choose **Independent** in the same selector to make the branch its own organization. Dropping on ordinary empty space does not split a team. Review **Change reporting?** and choose **Confirm move**, or **Cancel** to restore the current manager selection. The dialog keeps any refusal visible and blocks duplicate submission while applying. The branch's internal reporting lines remain intact.

These are operator actions. An agent's native `move` remains within its organization. The runtime validates the current lasting branch against the people shown when the change was proposed. An unexpected new lasting report makes the operation stale; review and retry. A temporary person cannot be selected as the branch head or new manager, but temporary descendants follow their existing parent and still participate in cycle and work-safety checks.

A move preserves identities, roles, hire dates, assignments and focus. A task keeps its originally recorded organization head as its **anchor**; its current organization is the tree that anchor now belongs to. If a move would newly separate an unfinished assignee from their task's organization, it is refused with the blocking task IDs. Finish the work or explicitly hand it off through the existing assignment tools first. Moving an entire organization under another head keeps its recorded task anchor with its assignees, so it does not create that separation. Existing invalid assignments are not silently repaired or used to block an otherwise safe move.

An independent branch remains independent on reconnect or call-in: a recorded null manager wins over an old launch flag. Runtime reporting, prompt identity, channel membership and later close notices follow the recorded tree. Use World's existing **Send home** and **Call in** controls for lifecycle actions; these are not additional Org profile controls.

### Add one person immediately

Use **Add person** on a team card or in a focused team. Choose the catalog **Role**, an optional **Name**, **Repository** and concrete **Goal**. Role details show its mandate and whether it manages, writes or advises. Submitting starts an ordinary Pi session immediately under the selected running manager; a blank name uses native automatic naming. It is not a position waiting for Start team.

A refusal before any start remains editable. Once a start has a session identity, an accepted, failed or uncertain response can still have saved that person and their goal. The form retains the identity for inspection and prevents another submission from creating a duplicate. Closing is disabled while the request is in flight. A confirmed person is selected from the actual team; this does not open or acknowledge their conversation.

### Plan first, then Start team

**New team** instead plans positions first and applies them only through Start team.

**New team** is an unstarted plan: fill **Team task**, **Repository** and **Head role**. Use **Role to add** and **Add role** repeatedly for several positions of the same role, or choose an **Existing teammate** and **Add teammate**. Selecting an existing manager includes their branch. Each planned position has an optional name, **Position goal** and **Reports to**. The head and other planned managers must be able to manage. Planning opens no processes or model turns, and staging an existing person leaves their current reporting line unchanged. Drafts survive tab switches but not a page reload or app restart.

**Start team** validates the plan and prepares managers before reports. Each new person receives a real role and assigned goal through an ordinary runtime start, with its automatic opening prompt withheld. Existing people keep their work; retries use recorded identities and command receipts rather than creating replacement people or duplicate goals. Preparation is progressive: applied hires, wakes and reporting changes remain real if a later position fails. There is no automatic rollback. A preflight refusal remains editable only when the runtime journal records no earlier setup action for that plan. Once preparation has begun, keep the same identities and plan: changing a prepared new person's role, directory or goal is refused rather than silently rewriting their work.

Before Start team, the interface discloses that the operator joins the resulting whole-tree channel as a pull participant. Joining does not read its history or advance its cursor. This membership lets normal operator-authored readiness posts use the existing channel access rules.

Withholding the opening prompt is not a universal pause. Replayed startup mail rides a later turn, but new live mail and deliberate Chat or terminal instructions can still start work. Someone already working is shown as active, not interrupted or claimed to be held.

By default the controller waits for everyone to be ready before sending one kickoff to the head. **Start with ready teammates** explicitly permits a subset once the head is ready. The kickoff is operator mail addressed only to that head, containing the team goal and the IDs of the initially ready teammates. Later successful retries post an aggregate readiness update in the shared channel, mentioning only the head; report names and IDs stay out of the body so the update does not accidentally start their turns. It is not a second kickoff. Readiness compares people with that recorded initial roster and earlier notices, not their process start times: a later-arriving existing person can be announced, while restarting an already-ready person does not announce them as new.

Progress distinguishes pending, preparing, ready, active, blocked, failed and uncertain positions. A missing bridge or an unresolved start receipt is uncertainty, not proof that a person is at home or safe to launch again. Reconcile the recorded process/receipt before retrying. Closing the app leaves prepared people and their work intact. An old runtime without whole-tree channels is refused before preparation with an explicit restart warning; the controller does not restart it.

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

Manager channels (`team:<manager-id>`) include that manager and their direct reports. Whole-tree channels (`organization:<head-id>`) include a head and its lasting descendants, including people at home. A whole-tree channel stays anchored to its original head after a merge; a later split reuses that head's existing channel, or creates one when absent. The larger organization also gains the incoming branch as ordinary members. Messages stay in their original channel; reporting changes copy no history. Explicit invitations survive moves.

You can preview a channel's visible history without becoming a participant or acknowledging it for anyone. **Join channel** explicitly adds the operator as a pull reader; **Joined > Leave channel** removes that participation. Joining itself does not mark history read. Repeat joins preserve the cursor; leaving and rejoining starts fresh.

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

The React entry is `apps/agent-world/web/entry.ts`; Workplace lives in `web/workplace.tsx` and `web/workplace.css`. Org's view lives in `web/workplace-org.tsx`, its team overview/hierarchy in `web/workplace-org-chart.tsx`, reporting confirmation in `web/workplace-org-confirm.tsx`, and immediate recruitment in `web/workplace-add-person.tsx`. `web/workplace-work-history.tsx` presents recorded work, while `web/workplace-org-search.tsx` searches snapshot metadata. Its query-only command controller is `src/backend/org.ts`, with public DTOs in `src/org.ts`. Profiles live in `web/workplace-people.tsx`; session rendering remains shared with World. All pages use the narrow typed preload API. Electron allows only the exact internal World/Workplace routes and delegates explicit external link opening through the existing policy.

Build with `npm run build:world`; committed `dist/` must match source. See [development](development.md#agent-world) for focused browser/backend checks. Historical design and evaluation evidence remains in the ledger; this page owns current product behavior.

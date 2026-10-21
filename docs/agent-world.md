# Agent World

Agent World is a desktop app that shows your Pi sessions as characters in a hand-painted world. Every live top-level Pi session in tmux is a character: the root of an [organization](organization.md) stands in its headquarters, the people that report to it work in their repository's wing or, under a manager, in that manager's team room, independent sessions stand in the town square, and stopped sessions sleep at the inn. From the world you can talk to any agent, answer its questions, redirect or stop it, wake a sleeping one, and work with GitHub, Jira, Confluence, and Slack without going to the terminal. The terminal stays one click away.

Agent World shows what the [session-state](session-state.md) model records. It reads the session-state database read-only and sends every change (a reply, an answer, mark seen, a wake, your theme and look) to the runtime as a command with a receipt. It never writes to the database itself.

The source is in `apps/agent-world/`; see [Development](development.md#agent-world) for building and checking it.

## Opening it

Run `/world` in a root Pi session. The first time, it installs Electron 44.9.0 under `~/.pi/agent/agent-world/electron-44.9.0/` (or `$PI_CODING_AGENT_DIR/agent-world/`): an npm install and a download of about 100 MB from GitHub. The status line shows the progress. Apple Pi does not depend on Electron, so nothing is downloaded until you first run `/world`. A failed install leaves nothing behind and says why; run `/world` again to retry.

Agent World starts detached, so it keeps running after the session that opened it ends. Only one Agent World runs at a time: `/world` while it is open brings its window to the front. When it fails to start, the reason is in `~/.pi/agent/agent-world/electron.log`.

Closing the window quits Agent World and changes nothing in tmux or Pi: your sessions keep running, and nothing is stopped or marked.

## The world

The world opens in the headquarters of your first organization: the session you are in, or one with a managing role (`pi --role coordinator`), that others report to. A second root is a second headquarters. Each other function has its own place, reached through the doors of the town square or from the Places tab.

| Place | What it shows | What you can do |
| --- | --- | --- |
| Headquarters | The organization's root at its desk; a gallery of doors, one per repository its people have worked in, each with the repository's banner, and one team room per manager under the root, with the manager's name; a common room for people outside any repository | Talk to the root; hire at its desk; read and write the notes at its board; walk into a wing. A wing stays once it has had an agent, closed when its agents are asleep and boarded when it has none |
| Wing | The people that report to the root and work in that repository, seated at their tables; a team room holds a manager and everyone under it | Talk to them, open their terminal, hire into a manager's team |
| Town square | Independent agents, and one townsperson for each Slack channel with unread messages (mentions first, then the newest; those the square has no spot for stand in the street) | Read a channel and its threads (each opens at its first new message); mark a channel or a thread read; reply in a thread as yourself; ask an agent to look into a thread. The crier searches all of Slack, as Slack's own search bar does: type, then press Enter or Search (nothing is asked while you type). Channels named like it come first, then the messages found in every channel, direct message, group, and thread you can see, each with its channel, sender, time, and the matching words marked; opening one reads its channel (or thread) at that message. The crier also lists every channel and conversation you are in, unread first, with a name filter that narrows the list as you type. The recruiter at its booth recruits an independent agent |
| Street | The square's second open-air place, through its exit (the fantasy harbour lane, the tech office's main street, the anime school's shopping street): the townsfolk for unread Slack channels the square has no spot for | The same as in the square for the townsfolk standing here |
| Forge | Your open pull requests and those of your agents, laid on the benches by CI state (passing, failing, running); the rest on the rack and in the smith's list | Read a pull request's card (CI checks, review state, the agent on its branch); review its diff and comment, approve, or request changes as yourself; ask the agent that built it to address the review, or the coordinator to get it reviewed |
| Quest office | The Jira issues assigned to you, pinned on the board | Search every issue; read one in full; comment on it or move it as yourself; hand it to the coordinator |
| Library | The Confluence pages you read lately | Search all of Confluence; read a page in a panel or open it in the browser; ask an agent to summarise or update it |
| Inn | Dormant agents asleep at the tables and in the beds, the newest first; the rest are upstairs. A former member (one that retired) sleeps here too, marked with its role and why it left | The innkeeper's register lists every one with its repository and last ledger task; read its last conversation; wake it |
| Rookery | Recent mail between agents, and mail waiting for agents that are asleep | Read the traffic; write to any agent as yourself |

Theme packs name the places in their own words (the forge is a hardware lab in the tech office theme), but every theme has the same places and actions. Every place offers to open the real tool (GitHub, Jira, Confluence, Slack) in your browser.

Waking a dormant agent reopens its session in a new tmux window beside your current pane, in its own directory and still reporting to its coordinator. It needs a tmux client attached.

The notes are your notepad in each headquarters, at its board (the guild's notice board, the office whiteboard, the school's bulletin board) or with Read the notes on the coordinator. They are `NOTES.md` in the coordinator's directory, so the coordinator and any agent you ask can edit the same file with their ordinary tools. Type freely: the notes save as you pause, and a change on disk (an agent's update) loads at once while you have nothing unsaved. If you have unsaved edits when the file changes, you choose to load the file or keep yours. Ask an agent to add an update here puts a marker line at your cursor and mails the agent you choose (the coordinator first) to replace that line with what you asked for. Send selection to an agent mails the selected text, quoted with the file's path, and your optional note. The coordinator's guidance names the file, so it reads your notes too. The notes need the coordinator awake.

Hiring starts a new person, in the theme's words (the guild recruits, the office hires, the club invites). The root's desk, or the action on any manager, hires a person who reports to that manager; the recruiter in the town square hires an independent one. The form asks for a name, a role from the [catalog](organization.md) (each role's title, with its mandate under the choice; at the square the person may also have no role, like your own sessions), a repository (one of the world's wings or awake agents' repositories, or any directory you type), and an opening brief, its first prompt. A hired person's window opens right after its manager's pane; an independent one's after your current pane, which needs a tmux client attached. The form shows the receipt, and the new person walks into its room or the square.

Examining a person shows its role's title, the one line of its soul, the headings of its self, who it reports to, the ledger task it holds, and its record of earlier tasks. Your own sessions have no role or soul, so those rows are absent. A person with a role can retire, in the theme's words (leave the guild, resign, graduate): say why, and its session ends and it sleeps at the inn as a former member, where a manager can call it back.

### Moving and acting

Hover over anything to see what a left click does, in the top-left corner. Left click does it; right click lists every action. Your avatar walks up to a character or a door before acting. Click the floor to walk there; a new click changes course at once. The mouse wheel zooms; the arrow keys and W, A, S, D move the view. G shows the walk grid. Things to fidget with (a cat to pet, a bell to ring, candles to light) are in every place and never change any work. Some people are there just for company, such as a bard at the inn, a barista in the cafe lounge, or the staff every headquarters shares in its hall and common room (a quartermaster in the guild hall, an SRE on call on the office floor): talk to one to hear its next line, and click it again and again to see how it takes that. They never change any work either.

A character's badge shows its state: working, asking you something, or finished and not yet seen. An agent asking you raises its hand, and characters that need you say so now and then in a speech bubble. When the session-state runtime is gone, the world says it is disconnected and shows the last known state.

## The interface

Around the world, laid out as in Old School RuneScape and styled by the theme:

- **Minimap** (top right): the whole place, with dots for agents, townsfolk, and you; click it to walk there. Its orbs count the agents that need you, the agents working, and your unread Slack messages.
- **Side panel** (right), with tabs: **Agents** (every character, grouped by where it is, each row with what it works on: its ledger task, else its stated intent), **Needs you** (questions first, then finished work, the longest-waiting first; a character that works again leaves it, and its working dots carry a small tick while the earlier result is unseen), **Work** (agents grouped by ledger task; those without one show what their session says it works on now), **Mail**, **Slack** (the unread channels, or every channel you are in with a name filter; Ask the crier to search Slack), **Places** (travel anywhere at once), and **Settings**. Every action on a character works from here without walking: talk to it, examine it, go to it, open its terminal, rename it, or end its session. Rename (here or in its right-click menu in the world) opens a small form with its current name; saving renames its Pi session and shows the receipt. Click the open tab again to fold the panel.
- **Chatbox** (bottom left): world events (where you are, what you did, what agents did, mail, Slack, commands and their receipts, writes outside), filterable by kind.

### Talking to a character

Talking to a character opens the conversation panel over the dimmed world: its portrait, name, repository, ledger task (or, without one, what the session says it works on now: its stated intent, see [session titles](context.md#session-titles)), and what it is doing now; the whole transcript in Markdown with tool calls folded to one line each; its reply streaming in as it is written; and older history as you scroll up. Opening it marks the character seen everywhere (the sidebar, the notch, the status line). A web link in the transcript opens in your browser. A link to a file (a path, relative to the agent's directory, or a `file:` URL, with any `:12` line suffix ignored) opens in your default app for that file; a file that could run (an app, a script, anything with an execute bit) is shown in Finder instead. Links of other kinds show their target on hover only.

What you can send depends on its state:

- **Idle:** Reply.
- **Busy:** Redirect now, Tell it after this, and Stop. Stop asks you to confirm first.
- **Asking:** its question as a form, with each option's description and a free-text answer. Answering closes the question in the terminal too. A dialog only the terminal can answer says so.

Each instruction shows its receipt: accepted, delivered, applied, or failed with why. **Go to its terminal** switches your tmux client to the agent's pane. A sleeping agent's panel shows its last conversation and offers Wake instead.

Talking to an agent never posts anything to Slack or anywhere outside. Delegating from a place (address a review, start work on an issue, summarise a page, look into a thread) sends the agent an ordinary instruction naming the item; nothing is written to GitHub, Jira, Confluence, or Slack.

Only one panel is open at a time: opening a place's panel or a conversation closes any other. Escape closes the panel, or first the confirmation shown over it.

## Themes

Settings offers the installed themes: **Fantasy** (a guild hall and village), **Tech office**, and **Anime school**. Switching changes only how the world looks and what things are called; the same characters, states, panels, and actions remain. Your choice is kept across restarts. Settings also offers the avatar looks of the current theme.

A theme pack is a directory of files, not code: a manifest, a stylesheet, paintings with their place data, character sheets with portraits, and overlays. The format is in [`apps/agent-world/themes/README.md`](../apps/agent-world/themes/README.md). A broken pack fails safely: the world stays in, or opens in, the last good theme and says on screen which file is wrong and why.

## Signing in

GitHub works through the `gh` CLI with its own sign-in (`gh auth login`); Agent World keeps no GitHub credential.

Atlassian (Jira and Confluence) and Slack are signed in from **Settings**:

- **Atlassian:** your site (`acme.atlassian.net`), your email, and an [API token](https://id.atlassian.com/manage-profile/security/api-tokens). Agent World checks them against the site before keeping them.
- **Slack:** **Sign in to Slack** opens Slack's own sign-in in a separate window. Once you are signed in, Agent World keeps the web client's session token and its `d` cookie, and closes the window. That window keeps its own cookies, apart from the world's.

Both are kept in `~/.pi/agent/state/agent-world-credentials.json`, readable only by you (mode `0600`). They are read only by Agent World's main process and never reach the world's page, the theme packs, or any log; Settings shows only the account you are signed in as. **Sign out** in Settings removes them from the file.

## Writing outside as yourself

A pull request comment, approval, or change request; a Jira comment or move; and a Slack reply are written as you. Each one first shows a confirmation with exactly what is done, where, and the exact text. Nothing is sent until you choose **Send as you**; Don't send, Escape, or a click outside sends nothing. A confirmation is good for that one write only: a changed text needs a new confirmation.

Reading a Slack channel or thread changes nothing in Slack. **Mark read** marks the channel (or, under a thread, that thread) read in Slack as you, up to its newest message; the button is the choice, so it asks no confirmation, and the channel's townsperson leaves the square. A channel opened at a message found by search shows the messages around it; when newer ones follow, it says so, and Mark read waits until **Show the newest** reads the channel as usual. Searching changes nothing in Slack.

Every write you send (a Mark read too), whether the service accepted it or not, is logged in the chatbox and appended to your local record, `~/.pi/agent/state/agent-world-outside-writes.jsonl` (mode `0600`): one JSON line per write with its time, kind, what, where, the text, its link, and whether it succeeded or why not. Agent World never removes or rewrites lines in it.

## What Agent World keeps

Agent World owns no record of your work. Everything it shows comes from the session-state database, your ledger tasks, and the services above. What it keeps itself:

| What | Where |
| --- | --- |
| Remembered wings and their order, your theme, and your avatar look | The `agent-world` preference in the session-state database, written through the runtime |
| Atlassian and Slack sign-ins | `~/.pi/agent/state/agent-world-credentials.json` |
| The record of writes outside | `~/.pi/agent/state/agent-world-outside-writes.jsonl` |
| Pages read lately in the library | `~/.pi/agent/state/agent-world-library-recent.json` |
| Electron | `~/.pi/agent/agent-world/electron-44.9.0/` |
| Electron's own data (window state, the Slack sign-in window's cookies, the last good theme) | `~/.pi/agent/agent-world/electron-data/` |
| Why the app failed to start | `~/.pi/agent/agent-world/electron.log` |

With `PI_CODING_AGENT_DIR` set, `~/.pi/agent` is that directory instead.

## Removing it

Quit Agent World, sign out of Atlassian and Slack in Settings if you want the sign-ins gone, then delete `~/.pi/agent/agent-world/` (Electron and its data) and, if you like, the `agent-world-*` files in `~/.pi/agent/state/` (the sign-ins, the record of writes outside, and the recent pages). The `agent-world` preference in the session-state database is a few bytes and does nothing without the app. `/world` installs Electron again the next time you run it.

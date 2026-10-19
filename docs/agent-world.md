# Agent World

Agent World is a desktop app that shows your Pi sessions as characters in a hand-painted world. Every live top-level Pi session in tmux is a character: the coordinator stands in its headquarters, the agents that report to it work in their repository's wing, independent agents stand in the town square, and stopped sessions sleep at the inn. From the world you can talk to any agent, answer its questions, redirect or stop it, wake a sleeping one, and work with GitHub, Jira, Confluence, and Slack without going to the terminal. The terminal stays one click away.

Agent World shows what the [session-state](session-state.md) model records. It reads the session-state database read-only and sends every change (a reply, an answer, mark seen, a wake, your theme and look) to the runtime as a command with a receipt. It never writes to the database itself.

The source is in `apps/agent-world/`; see [Development](development.md#agent-world) for building and checking it.

## Opening it

Run `/world` in a root Pi session. The first time, it installs Electron 44.9.0 under `~/.pi/agent/agent-world/electron-44.9.0/` (or `$PI_CODING_AGENT_DIR/agent-world/`): an npm install and a download of about 100 MB from GitHub. The status line shows the progress. Apple Pi does not depend on Electron, so nothing is downloaded until you first run `/world`. A failed install leaves nothing behind and says why; run `/world` again to retry.

Agent World starts detached, so it keeps running after the session that opened it ends. Only one Agent World runs at a time: `/world` while it is open brings its window to the front. When it fails to start, the reason is in `~/.pi/agent/agent-world/electron.log`.

Closing the window quits Agent World and changes nothing in tmux or Pi: your sessions keep running, and nothing is stopped or marked.

## The world

The world opens in the headquarters of your first coordinator (a session started with `pi --coordinator`, or one that other sessions report to). Each other function has its own place, reached through the doors of the town square or from the Places tab.

| Place | What it shows | What you can do |
| --- | --- | --- |
| Headquarters | The coordinator at its desk; a gallery of doors, one per repository its agents have worked in, each with the repository's banner; a common room for agents outside any repository | Talk to the coordinator; walk into a wing. A wing stays once it has had an agent, closed when its agents are asleep and boarded when it has none |
| Wing | The agents that report to the coordinator and work in that repository, seated at their tables | Talk to them, open their terminal |
| Town square | Independent agents, and one townsperson for each Slack channel with unread messages (as many as the square has spots; mentions first, then the newest) | Read a channel and its threads; reply in a thread as yourself; ask an agent to look into a thread. The crier reaches any channel, read or unread |
| Forge | Your open pull requests and those of your agents, laid on the benches by CI state (passing, failing, running); the rest on the rack and in the smith's list | Read a pull request's card (CI checks, review state, the agent on its branch); review its diff and comment, approve, or request changes as yourself; ask the agent that built it to address the review, or the coordinator to get it reviewed |
| Quest office | The Jira issues assigned to you, pinned on the board | Search every issue; read one in full; comment on it or move it as yourself; hand it to the coordinator |
| Library | The Confluence pages you read lately | Search all of Confluence; read a page in a panel or open it in the browser; ask an agent to summarise or update it |
| Inn | Dormant agents asleep at the tables and in the beds, the newest first; the rest are upstairs | The innkeeper's register lists every one with its repository and last ledger task; read its last conversation; wake it |
| Rookery | Recent mail between agents, and mail waiting for agents that are asleep | Read the traffic; write to any agent as yourself |

Theme packs name the places in their own words (the forge is a hardware lab in the tech office theme), but every theme has the same places and actions. Every place offers to open the real tool (GitHub, Jira, Confluence, Slack) in your browser.

Waking a dormant agent reopens its session in a new tmux window beside your current pane, in its own directory and still reporting to its coordinator. It needs a tmux client attached.

### Moving and acting

Hover over anything to see what a left click does, in the top-left corner. Left click does it; right click lists every action. Your avatar walks up to a character or a door before acting. Click the floor to walk there; a new click changes course at once. The mouse wheel zooms; the arrow keys and W, A, S, D move the view. G shows the walk grid. Things to fidget with (a cat to pet, a bell to ring, candles to light) are in every place and never change any work.

A character's badge shows its state: working, asking you something, or finished and not yet seen. An agent asking you raises its hand, and characters that need you say so now and then in a speech bubble. When the session-state runtime is gone, the world says it is disconnected and shows the last known state.

## The interface

Around the world, laid out as in Old School RuneScape and styled by the theme:

- **Minimap** (top right): the whole place, with dots for agents, townsfolk, and you; click it to walk there. Its orbs count the agents that need you, the agents working, and your unread Slack messages.
- **Side panel** (right), with tabs: **Agents** (every character, grouped by where it is), **Needs you** (questions first, then finished work, the longest-waiting first), **Work** (agents grouped by ledger task), **Mail**, **Slack**, **Places** (travel anywhere at once), and **Settings**. Every action on a character works from here without walking: talk to it, examine it, go to it, or open its terminal. Click the open tab again to fold the panel.
- **Chatbox** (bottom left): world events (where you are, what you did, what agents did, mail, Slack, commands and their receipts, writes outside), filterable by kind.

### Talking to a character

Talking to a character opens the conversation panel over the dimmed world: its portrait, name, repository, ledger task, and what it is doing now; the whole transcript in Markdown with tool calls folded to one line each; its reply streaming in as it is written; and older history as you scroll up. Opening it marks the character seen everywhere (the sidebar, the notch, the status line).

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

Every write you send, whether the service accepted it or not, is logged in the chatbox and appended to your local record, `~/.pi/agent/state/agent-world-outside-writes.jsonl` (mode `0600`): one JSON line per write with its time, kind, what, where, the text, its link, and whether it succeeded or why not. Agent World never removes or rewrites lines in it.

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

# Tmux sessions

Run many Pi sessions across projects, each in its own tmux session, then list
them, see which are `working` / `waiting` / `idle`, and jump to one from a
single popup. Adapted from
[tmux-claude-session-manager](https://github.com/craftzdog/tmux-claude-session-manager)
(MIT, Takuya Matsuyama) and retargeted to Pi; see `THIRD_PARTY_NOTICES.md`.

Claude Code publishes agent status through `claude agents --json`. Pi has no
such command, so this integration has two halves:

- A Pi **extension** (`components/tmux-sessions/src/`, registered from
  `extensions/tmux-sessions.ts`) that publishes each session's live status to
  disk.
- A set of **bash scripts and a tmux entrypoint**
  (`components/tmux-sessions/scripts/`, `pi_session_manager.tmux`) that read
  those records and drive the picker, launcher, and bell forwarding.

## The state contract

Each root Pi session running inside tmux writes one JSON record to
`~/.pi/agent/state/tmux-sessions/<sessionId>.json` (override with
`PI_TMUX_STATE_DIR`). The record shape is owned by
`components/tmux-sessions/src/state.ts`:

```json
{
  "schema": 1,
  "sessionId": "…",
  "pid": 12345,
  "status": "busy | idle | waiting",
  "cwd": "/path/to/project",
  "sessionName": "optional display name",
  "paneId": "%3",
  "windowId": "@2",
  "paneTty": "/dev/ttys009",
  "startedAt": 1700000000,
  "updatedAt": 1700000000
}
```

Status is derived from agent lifecycle events:

| Event | Status |
| --- | --- |
| `agent_start` | `busy` |
| `ask_user_question` executing | `waiting` (needs you) |
| `agent_settled` (idle) | `idle` (your turn) |
| `session_shutdown` | record removed |

`agent_settled` fires on interrupt and error too, so the `busy → idle`
transition is unconditional rather than tied to a successful turn. Writes are
atomic (temp file + `rename`) so the picker never parses a half-written record.
Only root interactive (`tui`) sessions publish; subagents and `pi_exec` workers
are excluded so the picker lists jump targets, not internal workers. A same-pane
session switch, resume, or fork drops the old record and republishes under the
new session id.

### Liveness

A record is trusted only when **both** its pid is still running **and** its
`paneId` still exists in `tmux list-panes -a`. Either check alone is
insufficient: a SIGKILL'd Pi never runs its shutdown hook, and pid reuse could
otherwise mask a stale record. `agents.sh` prunes records whose pid is gone.

## Install

Load the extension in Pi (it is part of this package), then load the tmux
plugin. With [tpm](https://github.com/tmux-plugins/tpm) pointing at your
checkout, or directly in `~/.tmux.conf`:

```tmux
run-shell ~/code/apple-pi/components/tmux-sessions/pi_session_manager.tmux
```

Requirements: tmux ≥ 3.2 (for `display-popup`),
[fzf](https://github.com/junegunn/fzf), and [jq](https://jqlang.org/).

## Keys

| Key | Action |
| --- | --- |
| `prefix` + `y` | Launch (or re-attach to) a Pi session for the current directory, in a popup |
| `prefix` + `u` | Open the session picker |

Inside the picker: `enter` jumps to the session, `ctrl-x` kills the highlighted
one, and typing filters. Sessions needing attention (`waiting`, `idle`) sort to
the top. Each row shows status, age, tmux location, a name, and the working
directory. The name is the Pi session name when set, otherwise the tmux pane
title (with Pi's spinner/`π` prefix stripped) or window name.

## `/pi-sessions`

Run `/pi-sessions` inside Pi to list the live published sessions and the state
directory path — useful for confirming the extension is publishing.

## Options

Set before the plugin loads (defaults shown):

```tmux
set -g @pi_launch_key     'y'      # prefix key: launch/open for current dir
set -g @pi_list_key       'u'      # prefix key: open the picker
set -g @pi_command        'pi'     # command run in new sessions
set -g @pi_args           ''       # extra args appended to the command
set -g @pi_session_prefix 'pi-'    # tmux session name prefix
set -g @pi_popup_width     '90%'   # popup width
set -g @pi_popup_height    '90%'   # popup height
set -g @pi_fzf_options    ''       # extra options passed to the fzf picker
set -g @pi_forward_bell   'on'     # highlight the origin window on a bell
set -g @pi_state_dir      ''       # override the record directory the scripts read
```

`run-shell` and `display-popup` inherit the tmux server's environment, not your
shell rc. If you override the record directory for the extension with
`PI_TMUX_STATE_DIR` (or `PI_CODING_AGENT_DIR`), that export is invisible to the
scripts and the picker will look empty. Set `@pi_state_dir` to the same path so
both halves agree.

## Bell forwarding

A dedicated `pi-*` session is a separate tmux session, so a bell inside it is
invisible to the window that launched it. On settle the extension writes `BEL`
to its own pane's pty (opt out with `PI_TMUX_SESSION_BELL=off`); tmux counts
that as a bell, the global `alert-bell` hook catches it, and `bell.sh` relays it
into the origin window's pane so `window-status-bell-style` highlights it. Set
`@pi_forward_bell 'off'` to disable the relay.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PI_TMUX_DISABLED=1` | Disable status publishing entirely. |
| `PI_TMUX_SESSION_BELL=off` | Do not ring the pane bell on settle. |
| `PI_TMUX_STATE_DIR=/path` | Override the record directory the extension writes to. Also set the `@pi_state_dir` tmux option so the scripts read the same path. |

## How it works

- The **launcher** creates a detached `pi-<hash-of-dir>` session running `pi`,
  records the launching window in `@pi_origin`, and attaches to it in a popup.
- **`agents.sh`** reads the JSON records, prunes dead ones, joins each `paneId`
  to a tmux pane, and prints one row per live session sorted by attention.
- The **picker** renders those rows with a live `capture-pane` preview. On
  `enter` a dedicated session resumes in the popup over its origin window, while
  a loose one is focused in place. `ctrl-x` terminates the Pi process.
- Pressing `prefix` + `u` from inside a session popup detaches that popup first,
  then reopens the picker full-size on the outer client.

# Tmux sessions

Run many Pi agents in ordinary tmux panes and keep one sidebar that shows which need you, what each one is, and what it is doing. Click a card to jump to that agent's pane.

The integration has three parts:

- A Pi **extension** (`components/tmux-sessions/src/`, registered from `extensions/tmux-sessions.ts`) publishes each root session's live status to disk and loads the tmux plugin.
- A **tmux plugin** (`pi_session_manager.tmux`, `scripts/sidebar.sh`) binds the key, moves the sidebar between windows, and records when you last looked at each pane.
- The **sidebar** (`components/tmux-sessions/sidebar/`) is a [Textual](https://textual.textualize.io/) app that `uv run --script` starts in a tmux pane.

## The state contract

Each root Pi session running inside tmux writes one JSON record to `~/.pi/agent/state/tmux-sessions/<sessionId>.json` (override with `PI_TMUX_STATE_DIR`). The record shape is owned by `components/tmux-sessions/src/state.ts`:

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
  "tmuxSocket": "/private/tmp/tmux-501/default",
  "startedAt": 1700000000,
  "updatedAt": 1700000000
}
```

Status is derived from agent lifecycle events:

| Event | Status |
| --- | --- |
| `agent_start` | `busy` |
| `ui_prompt_start` | `waiting` (a blocking extension prompt needs you) |
| `ui_prompt_end` | `idle` when the session is idle; otherwise `busy` |
| `agent_settled` (idle) | `idle` (your turn) |
| `session_shutdown` | record removed |

`ui_prompt_start` and `ui_prompt_end` cover every blocking extension UI, including `ask_user_question`'s questionnaire. `agent_settled` fires on interrupt and error too, so the `busy → idle` transition is unconditional. Writes are atomic (temp file + `rename`). Only root interactive (`tui`) sessions publish; subagents and `pi_exec` workers are excluded. A same-pane session switch, resume, or fork drops the old record and republishes under the new session id. On settle the extension also rings its pane's bell (opt out with `PI_TMUX_SESSION_BELL=off`), so tmux marks the window in its status line.

### Liveness

The sidebar shows a record only when its pid is running **and** its `paneId` exists in `tmux list-panes -a`. It deletes records whose pid is gone, and records whose pane is gone from the tmux server named in `tmuxSocket`; that catches a Pi killed without its shutdown hook whose pid the OS has since reused. A record from another tmux server is skipped, not deleted.

## Install

Nothing to add to `tmux.conf`. The first Pi that starts inside tmux runs `pi_session_manager.tmux` on that tmux server, and records the plugin's path and modification time in the server option `@pi_sessions_plugin`, so a later Pi skips it and an updated plugin reloads. It also sets `@pi_state_dir` to the extension's record directory, so the sidebar reads the same records even when `PI_TMUX_STATE_DIR` is set only in Pi's environment. Running `run-shell <path>/pi_session_manager.tmux` from `tmux.conf` also works; loading twice is harmless.

The plugin:

- binds `prefix` + `u` to the sidebar, `prefix` + `y` to jump, and `prefix` + `A` to the dashboard (override with `@pi_sidebar_key`, `@pi_jump_key`, and `@pi_dashboard_key` before it loads);
- appends `#{@pi_agents}`, the agent summary, to `status-right` once, and again if a config reload removed it;
- installs hooks at index `71` on `session-window-changed`, `client-session-changed`, and `pane-focus-in`, so reloading replaces them and your own hooks on those events stay;
- sets `focus-events on`, which `pane-focus-in` needs;
- stamps `@pi_seen_at` on every pane that has none, so agents that finished before tracking began count as seen.

Requirements: tmux ≥ 3.2 and [uv](https://docs.astral.sh/uv/) on the tmux server's `PATH` (the first start installs Textual). `run-shell` uses the tmux server's environment, not your shell rc.

## The sidebar

`prefix` + `u` opens the sidebar as a 42-column, full-height pane on the right of the current window, without taking focus. It then follows you: switching window or session moves the same pane, at its current width, into the new window. Panes make room for it in proportion and grow back in proportion when it leaves, so splits do not drift and resizes you make while it is there survive (`sidebar/layout.py` rewrites the window layout). `prefix` + `u` again closes it. There is one sidebar per tmux server and one process. A zoomed pane stays zoomed when the sidebar arrives or leaves, and the sidebar never enters the dashboard window.

A large count shows how many agents need you, or "all clear". Below it, agents sit in three lanes:

| Lane | Agents | Card |
| --- | --- | --- |
| NEEDS YOU | `?` asking you (a blocking prompt is open), `✓` done (settled since you last looked at its pane) | yellow or green border |
| WORKING | turn in progress, with a spinner | mauve border, 30-minute tool-call graph, context size and cost |
| QUIET | settled and seen | grey border |

Each card's title is the agent's name: the Pi session name, else the title of the ledger task the session most recently linked in `.ledger/*/history.json`, else the project directory. The body shows that ledger task and its status, and the agent's last tool call. The bottom border shows the tmux location and the time since the status changed; `◂ here` marks the pane you are looking at. Cost and the last tool call come from the session's JSONL log, read incrementally. NEEDS YOU lists the agent that has waited longest first. An agent that enters it flashes for four seconds. Hovering a card shows everything about the agent untruncated: name, ledger task, last tool call, model, context size, cost, location, and directory.

The sidebar paints the terminal's default background, so it stays translucent on a translucent terminal, and uses the Catppuccin Mocha palette.

| Key | Action |
| --- | --- |
| click | jump to that agent's pane |
| `j` / `k` | move the cursor (the sidebar must have focus: click it or move to its pane) |
| `enter` | jump to the selected agent |
| `x` / `X` | mark the selected / every agent as seen |
| `esc` | return to the pane you came from |
| `q` | close the sidebar |

### Seen

"Seen" is the tmux pane option `@pi_seen_at`: the `pane-focus-in` hook stamps it whenever a pane gains focus, and `x` stamps it by hand. An agent that settles while you watch its pane counts as seen, and so does an agent whose live view you read in the dashboard for three seconds. A rename, such as an automatic session title, is not a status change, so it never reopens an agent you have seen. The option lives and dies with its pane and works with no sidebar open; a tmux server restart forgets it.

## Status line and jump

The right end of the status line counts agents by state, for example `π ? 1 ✓ 2 ⠿ 3 · 1`: asking you, done and unseen, working, and idle, in the sidebar's colours. It is empty when no agent runs. Every status change, rename, and focus change recounts it, so it needs no polling.

`prefix` + `y` jumps to the agent that has needed you longest, skipping the pane you are in, so pressing it again walks the queue. With nothing waiting it says so.

## The dashboard

`prefix` + `A` opens a window named `π agents` in the current session, or switches to it if it exists anywhere; pressing it inside the dashboard returns to the window you came from. The window holds:

- a header with the counts by state, the number of agents, and their total cost;
- a table of every agent in the same attention order: state, name, ledger task, last tool call, time in state, context size, and cost;
- the selected agent's full details and its 30-minute tool-call graph;
- a live view of the selected agent's pane, refreshed twice a second.

Below 140 columns the table sits above the details instead of beside them.

| Key | Action |
| --- | --- |
| click a row, `j` / `k`, arrows | select an agent and show its live view |
| click the selected row, `enter` | jump to that agent's pane |
| `r` | reply: type a line into an idle agent's prompt without leaving the dashboard |
| `x` / `X` | mark the selected / every agent as seen |
| `p` | hide the table and give the live view the whole width |
| `esc` | close the reply box, or go back to the previous window |
| `q` | close the dashboard |

A reply goes only to an agent that is idle when you press `enter`; a busy agent or an open questionnaire needs you in its own pane.

## `/pi-sessions`

Run `/pi-sessions` inside Pi to list the live published sessions and the state directory, to confirm the extension is publishing.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PI_TMUX_DISABLED=1` | Disable status publishing and plugin loading. |
| `PI_TMUX_SESSION_BELL=off` | Do not ring the pane bell on settle. |
| `PI_TMUX_STATE_DIR=/path` | Override the record directory. |

## Development

`npm run test:sidebar` runs the sidebar and dashboard pytest suites through `uv`; `npm run lint` and `npm run format:check` run Ruff on it. The original prototype and its evaluation live in the ledger task `202610152308-tmux-agent-tracking`.

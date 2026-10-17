# Tmux sessions

Run many Pi agents in ordinary tmux panes and keep one sidebar that shows which need you, what each one is, and what it is doing. Click a card to jump to that agent's pane.

The integration has four parts:

- A Pi **extension** (`components/tmux-sessions/src/`, registered from `extensions/tmux-sessions.ts`) publishes each root session's live status to disk and loads the tmux plugin.
- A **tmux plugin** (`pi_session_manager.tmux`, `scripts/sidebar.sh`) binds the key, moves the sidebar between windows, and records when you last looked at each pane.
- The **sidebar** (`components/tmux-sessions/sidebar/`) is a [Textual](https://textual.textualize.io/) app that `uv run --script` starts in a tmux pane.
- The **notch panel** (`components/tmux-sessions/notch/`) is a small Swift app on macOS that shows the same agents in the MacBook notch, as workers in a pixel room.

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
  "reportsTo": "orchard-work",
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

The sidebar shows a record only when its pid is running **and** its `paneId` exists in this tmux server with the same `paneTty` (pane ids collide across tmux servers). It deletes records whose pid is gone, and records whose `tmuxSocket` names this server but whose pane is gone, which catches a Pi killed without its shutdown hook whose pid the OS has since reused. Records from another server, or written before records named their server, are skipped and left alone.

### Supervised sessions

A session that another session started and watches, such as an [Orchard](../skills/orchard/SKILL.md) worker, is started with `pi --reports-to <supervisor id>`. Its record carries that id as `reportsTo` (empty otherwise), and when it closes (quit, `/new`, `/resume` or `/fork`, but not `/reload`) it appends one message to the supervisor's [mailbox](tasks.md#session-mailbox), from its own session id:

```text
Session "JEM review" closed (quit) while busy. Directory: /path/to/repo
```

Killing its window or the tmux server sends the notice too, because Pi runs its shutdown hooks on SIGHUP. A crash, SIGKILL or power loss sends none; the supervisor finds those by comparing what it started with the live list.

`agents.py list` prints the live list as JSON, after the same liveness checks the sidebar uses: `id`, `name`, `status`, `cwd`, `reportsTo`, `paneId`, `tmuxSession` and `updatedAt` for each Pi session running in this tmux server. Run it inside tmux:

```bash
uv run -q --no-project python components/tmux-sessions/sidebar/agents.py list
```

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

Each card's title is the agent's name: the Pi session name, else the title of the ledger task the session most recently linked in `.ledger/*/history.json`, else the project directory. The body shows that ledger task and its status, and the agent's last tool call. The bottom border shows the tmux location and the time since the status changed; `◂ here` marks the pane you are looking at. Cost and the last tool call come from the session's JSONL log, read incrementally. NEEDS YOU lists the agent that has waited longest first. An agent that enters it flashes for four seconds.

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

## The notch panel

On a Mac, a black pill sits under the notch: the agent count, then one dot per agent. Dots for agents that need you or have finished sit on the left; working and quiet agents sit on the right. Hover the pill to open the pixel room of one tmux session. Each agent is a worker, posed by its state, with a bubble over its head: `…` working, `z` quiet, `!` needs you, `✓` done.

| Action | Effect |
| --- | --- |
| hover a worker | show its name, state, project, and last tool call |
| click a worker | jump to its pane; Ghostty comes to the front |
| drag a worker | move it in the room |
| `‹` / `›` | show the previous or next tmux session; opening the panel shows the session whose agent has waited longest |
| the vibe button, for example `☕ Office` | switch this session to the next vibe: office, cozy, nature, anime, ocean, or fantasy |
| `🎲` | pick another room and other workers for this session |

A crowded room grows, up to the size of the panel window. Every session uses the size of the most crowded one, so the panel does not jump while you cycle.

Your choices are kept in `~/.pi/agent/state/notch.json` and survive restarts. For each tmux session it holds the vibe (`vibes`), the room and worker look picked with the shuffle button (`rooms` and `looks`, keyed by `<vibe>/<session>`), and where you dragged each worker (`positions`, as fractions of the room's width and height). The panel rewrites the file whole after each change, so other tools can read it at any time.

### Requirements and start-up

The panel needs macOS, the Xcode command line tools (`swiftc`), and uv.

Each root Pi that starts in tmux on macOS runs `scripts/notch.sh start` in the background. The script compiles `notch/NotchShell.swift` into `~/.pi/agent/cache/notch/pi-notch-<source hash>` if that file does not exist yet, and starts it. The first build takes a few seconds.

One panel runs per Mac. It holds `~/.pi/agent/state/notch.lock` while it runs:

- A second start of the same build exits at once.
- A start of a changed build tells the running panel to quit, then takes its place, so an updated package shows on the next Pi start.

Without `swiftc`, nothing starts, and the script writes one line to `~/.pi/agent/logs/pi-notch.log`, which also holds build errors. Run `components/tmux-sessions/scripts/notch.sh start` to start the panel by hand, and `pkill -f cache/notch/pi-notch-` to stop it until the next Pi start. `PI_TMUX_DISABLED=1` keeps it off.

The panel reads its agents from `sidebar/agents.py feed`, the sidebar's own agent view as one JSON line per second, so it shows the agents of the default tmux server. If the feed stops, the panel starts it again a second later. When displays come or go, the panel moves to the screen with the notch, or to the top centre of the main screen when no notch shows (for example, with the lid closed).

### Adding rooms and workers

The raw art lives in `components/tmux-sessions/notch/art/raw/<vibe>/`, in the repository but not in the package. Each vibe folder holds `room-<name>.png` and `worker-<name>.png` files; a new folder becomes a new vibe on the vibe button. To add art, from `components/tmux-sessions/notch`:

1. Generate the image with the `generate_image` tool, or with `codex exec` and its image tool, following the prompt rules below.
2. Shrink it to a 256-colour PNG before committing. Generated images are otherwise 1–2 MB each, and the cleanup keeps only 48 colours anyway:

   ```bash
   uv run -q -w pillow python -c 'import sys; from PIL import Image; [Image.open(p).convert("RGB").quantize(256, dither=Image.Dither.NONE).save(p, optimize=True) for p in sys.argv[1:]]' art/raw/<vibe>/<new files>.png
   ```

3. Run the cleanup. It writes `web/assets/` and its `manifest.js`:

   ```bash
   uv run -q -w pillow -w numpy python art/clean.py
   ```

4. The running panel keeps its old art: stop it as above, and the next Pi start shows the new room or worker.

- **Room prompts:** a wide pixel-art room seen straight on, like a dollhouse cross-section, or an outdoor scene framed as a diorama stage. The floor fills the bottom 40% and stays completely empty from wall to wall: every piece of furniture and decor hangs on or stands against the back and side walls, because workers can stand anywhere on the floor and must not overlap a counter or a sofa. Ask for a plain dark navy backdrop around the room that reaches all four corners: the cleanup crops the room from that backdrop.
- **Worker prompts:** a 2×2 sprite sheet of the same character at the same desk (animals can sit at a tiny laptop on the ground instead), in this cell order: typing (top left), asleep with a small Zzz (top right), one hand raised with a yellow `!` (bottom left), cheering with sparkles (bottom right). Use crisp 16-bit pixels on a flat pure magenta (`#FF00FF`) background, with no text or logos. Give the worker one bright blue piece of clothing (a shirt, coat, scarf, or bandana) and hair that is not blue: the cleanup recolours the blue into six shirt colours. Avoid magenta props, which the cleanup removes with the background.

## Running it all day

- **Cost.** Measured with six agents, one of them working: the sidebar uses about 2% of one CPU core and 45 MB; a dashboard that no client is showing uses about 1.5% and 50 MB. Views redraw only what changed; a hidden dashboard stops capturing panes and animating, and catches up when you look at it.
- **Crashes.** The sidebar and dashboard panes restart their app two seconds after a crash. `q` or `prefix` + `u` closes them for good. A failed read shows one error toast and the view keeps going.
- **Memory.** Read positions and flash timers of ended sessions are dropped, so the views do not grow over days.
- **Session names.** Agents name themselves after their first turn (see [automatic session titles](context.md#session-titles)), so cards and rows do not all read as the project directory.
- **Restarts.** A tmux server restart forgets the bindings, hooks, and seen times; the next Pi that starts loads the plugin again. Pi agents started before an update keep writing their old record shape until they restart; the views still show them.

## `/pi-sessions`

Run `/pi-sessions` inside Pi to list the live published sessions and the state directory, to confirm the extension is publishing.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PI_TMUX_DISABLED=1` | Disable status publishing, plugin loading, and the notch panel. |
| `PI_TMUX_SESSION_BELL=off` | Do not ring the pane bell on settle. |
| `PI_TMUX_STATE_DIR=/path` | Override the record directory. |

## Development

`npm run test:sidebar` runs the sidebar and dashboard pytest suites through `uv`; `npm run lint` and `npm run format:check` run Ruff on it. The original prototype and its evaluation live in the ledger task `202610152308-tmux-agent-tracking`.

The notch panel's Vitest suite type-checks the Swift shell on macOS and runs `notch.sh` against a fake `swiftc`. Its page opens alone in a browser with mock agents, so you can work on it without the panel: open `notch/web/index.html`. The panel's prototype rounds live in the ledger task `202610160838-notch-agent-room`.

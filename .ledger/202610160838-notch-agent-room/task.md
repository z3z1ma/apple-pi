Status: planning
Created: 2026-10-16
Updated: 2026-10-16

# Notch agent room: a Mac notch UI that shows pi agents as a cozy pixel room

## Intent

A clean-room take on [Agent Shrine](https://agentshrine.com/) (closed-source Swift app) for pi and tmux. A panel in the MacBook notch shows what each root pi agent is doing; later it turns their work into a cozy pixel room. It lives in apple-pi.

Long term, the same renderer and generated assets should also run in a local web app and a cross-OS desktop app (Electron or Tauri). So the plan is a thin native shell that hosts a web renderer, not native drawing.

## Approach

- **Data:** reuse `components/tmux-sessions/sidebar/agents.py` (`AgentStore.poll()`): state records, tmux panes, session logs (last tool, cost, context), and ledger task. No new channel.
- **Shell:** a small Swift app: borderless non-activating `NSPanel` over the notch, transparent `WKWebView`, mouse click-through outside the hit area the page reports, and a feed subprocess.
- **Focus:** clicking an agent runs `components/notify/scripts/focus-tmux.sh` (activates Ghostty, switches tmux to the pane).

## Prototype 1: does a native notch panel work with our agent store?

Question: does a thin Swift notch shell that hosts a web page, fed by `AgentStore`, feel native? That means it hugs the notch, expands on hover, passes clicks through elsewhere, jumps to the pane on click, and stays cheap on CPU.

Scope: a collapsed pill with one dot per agent beside the notch, and an expanded list on hover. No pixel room or art yet.

Files in `prototype/`:

- `run.sh`: compiles the shell to `/tmp` and starts it.
- `NotchShell.swift`: panel, web view, feed process, hit-area and focus bridge.
- `feed.py`: prints one JSON line per second from `AgentStore.poll()`.
- `web/index.html`: the renderer. Opened in a browser alone, it uses mock agents.

Run: `.ledger/202610160838-notch-agent-room/prototype/run.sh`

Acceptance:

1. The pill sits flush under the notch on the built-in display and shows live agents' states.
2. Hover expands it; leaving collapses it; clicks outside the pill reach the app below.
3. Clicking an agent focuses its tmux pane in Ghostty.
4. Idle CPU of the shell and its web content stays low (measured with `ps`).

Result:

- Builds with `swiftc -O` (Swift 6.4, macOS 26.7).
- The pill sits flush under the notch and shows 6 live agents from `AgentStore`. Checked with a screenshot cropped to the notch.
- The expanded list renders correctly in headless Chrome with mock agents.
- Idle CPU over 15 s: shell 0–3 %, WebContent about 0.1 %, feed about 0.1 %, GPU process 0 %. RSS about 105 MB in total.

Verdict (operator, 2026-10-16): "Prototype is working great". Hover to expand, click-through, and click to focus work in the real panel. A thin Swift shell that hosts a web renderer is a sound base.

## Prototype 2: does a generated pixel room read well in the notch?

Question: can generated pixel art, after automatic cleanup, make a cozy room that shows each agent's state at a glance in the expanded notch?

Decisions (operator): generate the art with `generate_image`; one room per tmux session, with that session's agents inside.

Scope: the same shell and collapsed pill. When the pill expands, it shows `web/room.html`: one room per tmux session, sharing one background for now. Each agent is a character at a desk, posed by state (working, quiet, waiting, done); clicking a character focuses its pane. Raw generations go in `prototype/assets/raw/`, and the cleanup script (`assets/clean.py`: chroma key, box downscale to the art-pixel grid, palette quantize, hoodie recolour into 6 variants) writes `web/assets/`.

Run: `prototype/run.sh` (prototype 2, the default) or `prototype/run.sh index.html` (prototype 1).

Acceptance:

1. Each character's state is clear at a glance: typing (working), asleep (quiet), hand up with `!` (waiting), cheering (done).
2. Hovering a character shows its name, state and last tool; clicking it focuses its pane.
3. The pixels stay crisp (whole device pixels) and the room feels cozy.
4. Animation runs only while the panel is open; collapsed idle CPU stays near zero.

## Current State

Prototype 2 runs in the notch with live agents and is waiting for the operator's verdict. Checked:

- Generation and cleanup work in one pass: room 250×140 and agent frames about 35×40 art pixels, at the same pixel density. 6 agents fit on one floor in two staggered rows.
- Headless Chrome with mock agents (2 sessions, 6 agents) shows crisp rooms, a tooltip on hover, and no page errors.
- Collapsed idle CPU: shell, WebContent and feed 0.0 %.

Not yet checked: how it feels in the real notch, and whether the `!` reads at a glance at this size.

## Outcome

Pending.

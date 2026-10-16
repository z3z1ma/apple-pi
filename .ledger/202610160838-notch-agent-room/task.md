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

Question: can generated pixel art, after automatic cleanup, make rooms that show each agent's state at a glance in the expanded notch?

Decisions (operator):

- Generate the art with `generate_image`.
- One room per tmux session, showing one room at a time; arrows cycle the sessions.
- Two vibes to play with: **office** (fancy tech workplaces: kombucha tap, coffee shop with cold brew, glass HQ, game studio) with tech workers, and **cozy** (lofi rooms: loft, cabin, space lounge, tatami, wizard library) with the hoodie programmer. A toggle in the panel switches between them.

Scope: the same shell and collapsed pill. When the pill expands, it shows `web/room.html`: the room of one tmux session, themed by a stable hash of the session name. Opening shows the session whose agent has waited longest, if any. Each agent is a worker at a desk, posed by state, with a pixel bubble above its head drawn in code: `…` working, `z` quiet, `!` waiting, `✓` done. Hovering shows name, state and last tool; clicking focuses the pane.

Assets: raw generations live in `prototype/assets/raw/<vibe>/` (`room-*.png`, and `worker-*.png` 2×2 pose sheets on magenta). `assets/clean.py` keys out the magenta, downscales to the art-pixel grid, quantizes the palette, recolours the blue shirt into 6 variants, and writes `web/assets/<vibe>/` plus `web/assets/manifest.js`, which the page reads.

Run: `prototype/run.sh` (prototype 2, the default) or `prototype/run.sh index.html` (prototype 1).

Acceptance:

1. Each worker's state is clear at a glance from its bubble and pose.
2. Hovering a worker shows its name, state and last tool; clicking it focuses its pane.
3. Arrows cycle the tmux sessions; the vibe toggle switches office and cozy and is remembered.
4. The pixels stay crisp (whole device pixels), and both vibes feel fun.
5. Animation runs only while the panel is open; collapsed idle CPU stays near zero.

## Current State

Round 2 of prototype 2 runs in the notch with live agents and is waiting for the operator's verdict.

Operator feedback on round 1, and what changed:

- "The hover-over doesn't work": a panel that never becomes key gets no mouse-move events in its WKWebView. The shell now forwards the pointer position (`window.notch.pointer(x, y)`), and the page hit-tests from it. Clicks were already delivered.
- "I don't see the state icon": the sprites' own `!` and `Zzz` were too small. Each worker now has a 9×9 art-pixel bubble drawn in code.
- "More generated room themes", "more like offices", "I want to play with both": 4 office rooms, 2 office workers and 4 more cozy rooms, with a vibe toggle.
- "Cycle between rooms": one room at a time, with ‹ › arrows and an `n/m` count.

Checked in headless Chrome with mock agents: the forwarded pointer opens the tooltip, the arrows cycle sessions, the vibe toggle switches, the tooltip clears when the panel closes, and there are no page errors. Collapsed idle CPU after a restart: shell 0.1 %, feed 0.6 % (first seconds).

Not yet checked: hover and tooltips in the real notch with the forwarded pointer.

Known asset issues: the game studio room shows real game trademarks (Pac-Man, Street Fighter, Mario-like art); regenerate it before any use beyond this prototype. The braids worker is drawn a little larger than the others.

## Outcome

Pending.

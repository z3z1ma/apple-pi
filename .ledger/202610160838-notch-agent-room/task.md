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
- Two vibes to play with: **office** (fancy tech workplaces: kombucha tap, coffee shop with cold brew, glass HQ, game studio) with tech workers, and **cozy** (lofi rooms: loft, cabin, space lounge, tatami, wizard library) with lofi programmers. A toggle in the panel switches the shown tmux session between them.

Scope: the same shell and collapsed pill. When the pill expands, it shows `web/room.html`: the room of one tmux session, filling the panel, themed by a stable hash of the session name. The 🎲 button shuffles that session's room and its workers' sprites, remembered per vibe and session. Opening shows the session whose agent has waited longest, if any. Each agent is a worker at a desk, posed by state, with a pixel bubble above its head drawn in code: `…` working, `z` quiet, `!` waiting, `✓` done. Hovering shows name, state and last tool; clicking focuses the pane; dragging moves the worker, remembered per session.

Assets: raw generations live in `prototype/assets/raw/<vibe>/` (`room-*.png`, and `worker-*.png` 2×2 pose sheets on magenta). `assets/clean.py` crops each room to the largest interior rectangle that holds none of the backdrop around the room, keys out the magenta on worker sheets, downscales to the art-pixel grid, quantizes the palette, recolours the blue shirt into 6 variants, and writes `web/assets/<vibe>/` plus `web/assets/manifest.js`, which the page reads. To add a room or worker, put its raw image in `prototype/assets/raw/<vibe>/` and run `uv run -q -w pillow -w numpy python assets/clean.py` from `prototype/`. New room prompts need a plain dark backdrop around the room, and new worker prompts a blue shirt (see `.context/.ledger/202610160838-notch-agent-room/prototype/assets/clean.py.md`). A worker prompt asks for a 2×2 sprite sheet of the SAME character at the SAME desk, in this cell order, which `STATES` in `clean.py` reads: typing (top left), asleep with a small Zzz (top right), raising one hand with a yellow `!` (bottom left), cheering with sparkles (bottom right); 16-bit crisp pixels, flat pure magenta (#FF00FF) background, no text or logos.

Run: `prototype/run.sh` (prototype 2, the default) or `prototype/run.sh index.html` (prototype 1).

Acceptance:

1. Each worker's state is clear at a glance from its bubble and pose.
2. Hovering a worker shows its name, state and last tool; clicking it focuses its pane.
3. Arrows cycle the tmux sessions; the vibe toggle switches office and cozy for the shown session; 🎲 shuffles its room and workers; workers can be dragged into place. All of it is remembered per session.
4. The pixels stay crisp (whole device pixels), and both vibes feel fun.
5. Animation runs only while the panel is open; collapsed idle CPU stays near zero.

## Current State

Round 5 of prototype 2 runs in the notch with live agents. Operator: "we have gotten quite close to an acceptable prototype."

Operator feedback on round 4, and what changed:

- "I don't like the sprite of the old guy in a wheelchair": removed (`raw/office/worker-senior.png`). Office has 4 workers.
- "The dice roll should shuffle background and worker sprites": 🎲 picks another room and a new look seed for the shown session and vibe (`notch-looks`). The seed picks each agent's worker and shirt colour. Seed 0 is the default look.
- "Click and drag a sprite to a different position": mousedown on a worker starts a drag. Movement comes from native mouse moves (browser) and the forwarded pointer (shell; AppKit sends drags to the panel, and the shell's local monitor forwards `leftMouseDragged`). The worker's bottom-centre stays inside the room. Positions are stored per session and agent as fractions of the room size (`notch-positions`), so they survive scale changes. The pane is focused on mouseup only when the pointer moved 3 px or less, so a drag does not focus it.

Checked in headless Chrome: 🎲 changes the room and the sprites; a native drag moves and saves a worker without focusing it; a drag driven only by `window.notch.pointer()` between native mousedown and mouseup also moves it without focusing; a plain click still focuses; closing the panel drops a drag; looks and positions survive a reload; no page errors. Not checked: dragging in the real panel.

Operator feedback on round 3 ("I like it. The room size is better."), and what changed:

- "Workers … 5-10% smaller": `AGENT_PIXEL` 10 → 11 in `clean.py`, about 9 % smaller, still on the sprite-pixel grid.
- "Scale the room larger … with more workers", with the round-3 size as the minimum: workers keep 2.5 css px per pixel (`SPRITE`). The room scale starts there and grows in 0.5 steps until no two workers stand closer than 0.8 of the widest worker's width (`CROWDING`). It stops at the largest step that fits the shell window (3.5 for 1100×500). One scale serves every session, taken from the most crowded room, so the panel and its arrows stay put while cycling. A per-room scale made the panel shrink under the pointer and collapse. At 3.5 the room's pixels (7 device px) are visibly larger than the workers' (5 device px).
- "A few more varieties of sprites": office workers beanie and hijab (and senior, removed in round 5), and the cozy cat-hoodie worker. The cozy "sweater" worker (long ginger hair, freckles, oversized blue knit sweater, wooden desk with a laptop and tea) failed on image quota; generate it with the worker prompt pattern under Assets. The magenta key now goes by hue (285–315°), so purple props such as the wheelchair frame stay.
- "Vibe … tied to the specific tmux session": vibes are stored per session (`notch-vibes` in localStorage), defaulting to office.

Checked in headless Chrome with 8 mock agents in 2 sessions: the 6-worker room opens at 3.5, the 2-worker room keeps the same size, the vibe toggle changes only the shown session, a forwarded pointer opens the tooltip, and there are no page errors.

Operator feedback on round 2 ("Better"), and what changed:

- "A button to randomly change the room background": 🎲 next to the vibe toggle picks another room of the current vibe for the shown session, and remembers it.
- "The room background should be bigger … take up all the background instead of this bluish black": rooms are cropped to their interior (208×116 art pixels) and drawn at 2.5 css px per art pixel (5 device px), so the room fills the 520×290 panel and workers are 25 % larger. Checked in headless Chrome: all 9 rooms crop cleanly, the shuffle cycles rooms and persists across reload, and there are no page errors.

Round 1 feedback:

- "The hover-over doesn't work": a panel that never becomes key gets no mouse-move events in its WKWebView. The shell now forwards the pointer position (`window.notch.pointer(x, y)`), and the page hit-tests from it. Clicks were already delivered.
- "I don't see the state icon": the sprites' own `!` and `Zzz` were too small. Each worker now has a 9×9 art-pixel bubble drawn in code.
- "More generated room themes", "more like offices", "I want to play with both": 4 office rooms, 2 office workers and 4 more cozy rooms, with a vibe toggle.
- "Cycle between rooms": one room at a time, with ‹ › arrows and an `n/m` count.

Checked in headless Chrome with mock agents: the forwarded pointer opens the tooltip, the arrows cycle sessions, the vibe toggle switches, the tooltip clears when the panel closes, and there are no page errors. Collapsed idle CPU after a restart: shell 0.1 %, feed 0.6 % (first seconds).

Not yet checked: hover and tooltips in the real notch with the forwarded pointer.

Known asset issues: the game studio room shows real game trademarks (Pac-Man, Street Fighter, Mario-like art); regenerate it before any use beyond this prototype. The braids worker is drawn a little larger than the others.

Next: confirm dragging in the real panel, and generate the cozy sweater worker when the image quota allows. Then regenerate the game studio room without trademarks, and decide which vibe or vibes, rooms and workers carry into a real component.

## Outcome

Pending.

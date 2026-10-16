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

## Current State

Prototype 1 runs. Checked:

- Builds with `swiftc -O` (Swift 6.4, macOS 26.7).
- The pill sits flush under the notch and shows 6 live agents from `AgentStore`. Checked with a screenshot cropped to the notch.
- The expanded list renders correctly in headless Chrome with mock agents.
- Idle CPU over 15 s: shell 0–3 %, WebContent about 0.1 %, feed about 0.1 %, GPU process 0 %. RSS about 105 MB in total.

Verdict (operator, 2026-10-16): "Prototype is working great". Hover to expand, click-through, and click to focus work in the real panel. A thin Swift shell that hosts a web renderer is a sound base.

Next: prototype 2 explores the pixel room and its art direction inside the same shell.

## Outcome

Pending.

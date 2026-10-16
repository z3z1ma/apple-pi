Status: done
Created: 2026-10-15
Updated: 2026-10-16

# Agent tracking surfaces for tmux: list, sidebar, dashboard, status bar

## Intent

The operator runs several root Pi agents in ordinary tmux panes across sessions (observed: 3 in `CodingHarness:1`, 4 in `WORK`). Three problems hurt most:

1. **Who needs me?** A finished or asking agent goes unnoticed and sits idle.
2. **Which is which?** Agents in the same repository are indistinguishable. All 8 published records had an empty `sessionName`, so every row reads "apple-pi" or "work".
3. **Progress at a glance.** Seeing what a working agent does requires switching to it.

Evolve `components/tmux-sessions/` to solve these. When this task began, its Pi extension publishes one JSON record per root session (pid, pane, `busy`/`idle`/`waiting` status) under `~/.pi/agent/state/tmux-sessions/`, and bash scripts read the records for a `prefix + u` fzf popup picker; `docs/tmux-sessions.md` owns that contract. Keep that publisher as the single source of agent state; do not add a second detection service or scrape terminal output.

## Decisions

- **Scope:** root interactive Pi sessions only. Subagents, background tasks, and `pi_exec` workers stay out.
- **Surfaces:** a sidebar, a dashboard window, and a status-bar summary with a jump key. Sidebar and dashboard are **separate designs**, not one program at two sizes.
- **Sidebar = mini cards:** narrow, always visible, 2–3 lines per agent: name, ledger task, state, age. Ships first.
- **Dashboard = list + preview:** a dedicated window with a rich agent table and a large live preview of the selected agent's pane.
- **Order:** sidebar first, then data, then status bar, then dashboard.
- **Remove the dedicated launcher** (`prefix + y` starts Pi in a separate `pi-<hash>` tmux session shown in a popup; the operator never uses it): `launch.sh`, popup re-attach, `@pi_origin`, and bell forwarding into origin windows go. Ordinary panes are the only model.
- **Agent identity:** an automatic session name (see Session titles) plus the ledger task. The ledger already records the session-to-task link in `.ledger/<task>/history.json`, so the reader resolves it and the ledger needs no change.
- **Attention model:** add an "unseen" notion: the agent settled and the operator has not focused its pane since. "Needs you" means `waiting` or unseen-idle, not every idle agent.
- **Runtime:** Python + Textual via `uv run --script` (PEP 723); `uv` replaces `fzf` and `jq` as the requirement.
- **Layout:** "Cards in lanes" from the prototype.
- **Placement:** one sidebar that follows the active window. `prefix + u` turns it on; it follows window and session switches until turned off. Never one process per window.
- **Picker:** the fzf popup picker goes; `prefix + u` drives the sidebar.
- **Seen:** a `pane-focus-in` hook stamps the tmux pane option `@pi_seen_at`. It dies with the pane and works with no sidebar running; a tmux server restart forgets it.
- **Session titles:** in an unnamed root TUI session, the `quick` profile sets a provisional title from the first prompt, refines it after the first reply, and retitles when the session adds a ledger task or moves one to `in-progress`. A name the operator set is never overwritten; once the operator renames a session, auto-titling stops for it for good.
- **Install:** the Pi extension loads the tmux plugin itself, once per tmux server, so no `tmux.conf` line is needed.

## Plan: phase 1, sidebar to production

1. `components/tmux-sessions/sidebar/`: production `sidebar.py` + `agents.py` from the prototype, merged layout only, seen from `@pi_seen_at`. Keys: `j`/`k`, `enter`, `x`/`X`, `esc` (back to the last pane), `q` (close).
2. tmux plugin: `prefix + u` opens the sidebar without focus, or closes it (a plain on/off toggle; focus it by click or pane navigation). Hooks with fixed indexes (idempotent on reload): `session-window-changed` and `client-session-changed` move the sidebar into the current window; `pane-focus-in` stamps `@pi_seen_at`. Sets `focus-events on`, which `pane-focus-in` needs.
3. Remove the fzf picker, launcher, bell relay, their options, and their docs.
4. Pi extension loads the tmux plugin once per tmux server.
5. Session titles: new `components/session-title/` extension.
6. Docs, README, package files; Vitest for TypeScript; pytest with Textual's Pilot via `uv` for the sidebar.

Later phases: status-bar summary with a jump key; dashboard window.

## Resolved questions

- Status bar mechanics: neither polling nor pane options. Every record write, removal, and pane focus runs `sidebar.sh status`, which sets the server option `@pi_agents` from the pid- and tty-validated records; `status-right` shows `#{@pi_agents}`.

## Findings

- The tmux plugin was not loaded in the operator's tmux (`~/.config/tmux/tmux.conf` and `conf/keybinds.conf` have no `run-shell` for it), so `prefix + u` was unbound.
- Stale record not pruned: record for pane `%266` had pid 58159, which tmux no longer had as a pane and which the OS reused for `nvim`. Resolution: records now carry `tmuxSocket`, and an agent is shown only when its pane exists on this server with the same `paneTty`; a record naming this server whose pane is gone is deleted. Records without `tmuxSocket` are never deleted for a missing pane: treating them as local let a scratch tmux server delete every live agent's record on 2026-10-16 (rebuilt from the running Pi processes the same hour).
- tmux 3.5a crashes on `new-window` in a detached session with `window-size manual`; scratch tests avoid that option.
- tmux gives a leaving full-height pane's space to the rightmost pane and shrinks unevenly on arrival, so the following sidebar made splits drift; `sidebar/layout.py` rewrites layouts proportionally (exact round trip) and needs the sidebar to be the window's last pane.

## Runtime analysis

The TUIs run as separate processes in tmux panes, outside Pi's extension loader.

- **Finding the package.** A git install is a clone under `~/.pi/agent/git/…`; an npm install sits in Pi's npm directory. Before this task the operator had to hand-write `run-shell <path>/pi_session_manager.tmux`, which is how the plugin ended up unloaded. Chosen (see Install): the Pi extension knows its own path (`import.meta.url`) and, when it starts inside tmux, loads the tmux bindings itself once per tmux server. Bindings then exist whenever a Pi agent exists, with no `tmux.conf` line.
- **Node + `@earendil-works/pi-tui`.** pi-tui is a host-provided peer. Pi maps it into extensions but does not install peers for git or npm package installs, so a standalone `node sidebar.ts` cannot import it on another machine. It resolves in this checkout only through devDependencies, which would hide the defect. Using it means borrowing Pi's resolution (fragile) or running the sidebar as a Pi process (heavy). Plain Node without pi-tui means hand-written layout, scrolling, and mouse.
- **Python + Textual.** A PEP 723 script run with `uv run` installs Textual on first use; the requirement becomes `uv`, like `fzf` and `jq` today. Textual gives layout, cards, scrolling, mouse, timers, and ANSI preview rendering (Rich `Text.from_ansi`). Cost: Python becomes a production language in the repo (today only skill references and ledger checks are Python) and needs its own test lane (Textual's `Pilot`).

## Acceptance criteria

All met.

- [x] With N live root Pi panes, the sidebar and dashboard list exactly those N agents; stale state never appears; dead-pid records and same-server paneless records are deleted. (pytest pruning and collision tests; live check: 6 Pi panes, 6 records, 6 agents.)
- [x] Each agent shows a distinguishing name without manual `/name` after its first turn, and its ledger task when one is linked. (session-title Vitest suite; real Pi + real model on a scratch server titled itself "Explain tmux panes in one sentence".)
- [x] With the sidebar on, switching window or session moves the one sidebar pane into the new current window without taking focus; `prefix + u` turns it on and off; no `tmux.conf` line is needed once a Pi agent has started in tmux. (scratch server with an attached client; the real Pi self-loaded the plugin and stamped `@pi_sessions_plugin`.)
- [x] The fzf picker, launcher, and bell relay, with `fzf`/`jq` requirements and their options, are gone from code, docs, and tests.
- [x] An agent that settled while unfocused needs attention until its pane is focused; a `waiting` agent until its prompt resolves. (pytest; real Pi: `✓ 1` until a client focused the pane, then `· 1`.)
- [x] One key (`prefix + y`) jumps to the agent that has needed attention longest.
- [x] A status-line summary of agents by state.
- [x] A dashboard window: attention-ordered table, details, activity graph, live pane view, reply, seen-by-reading. (pytest Pilot suite; scratch-server toggle test.)

## Current State

Done. Committed on `main` (unpushed): `ce1d31c`, `bb2b520`, `08f4829`, `e2f6094`, `4a2ffa1`, `5e2d86a`, `b53f4e1`, `fc281a6`, `c125688`, `cf825e3`. The plugin is loaded in the operator's live tmux server (`prefix + u`, `y`, `A`; `#{@pi_agents}` in `status-right`).

Follow-up: `02117ba` makes title stages queue in order, so a fast first turn still applies its provisional title before the refined one (the real-model run above showed only the refined title because the refined stage used to abort the provisional request).

Not verified: the production sidebar and dashboard drawn by Ghostty itself (verified through tmux `capture-pane` and Textual screenshots), and a reply typed into a real agent from the dashboard (tested with a fake tmux). Running Pi agents started before these commits still use the old extension until restarted (no titles, no `tmuxSocket`), which the views tolerate.

Prototype: `prototype/` (see its README), verdict "Cards in lanes". Textual research notes: `notes/textual-capabilities.md`.

## Outcome

The fzf picker became an always-available agent cockpit: a Textual sidebar that follows you between tmux windows and sorts agents into NEEDS YOU / WORKING / QUIET lanes; a `π agents` dashboard window with a live view of any agent's pane and inline replies; a status-line count; a jump key; automatic session titles; and seen tracking from tmux focus. It needs only `uv` and loads itself into tmux.

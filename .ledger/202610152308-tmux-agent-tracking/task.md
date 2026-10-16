Status: in-progress
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

## Open questions

- Status bar mechanics: polling script in `#(...)` versus the extension writing a pane option (`@pi_status`) that formats aggregate with `#{P:…}`/`#{W:…}`/`#{S:…}` (tmux 3.5; untested). A pane option outlives a SIGKILL'd Pi when its shell pane survives, so that path needs reconciliation against live pids; otherwise keep the summary on the pid-validated record path.

## Findings

- The tmux plugin was not loaded in the operator's tmux (`~/.config/tmux/tmux.conf` and `conf/keybinds.conf` have no `run-shell` for it), so `prefix + u` was unbound.
- Stale record not pruned: record for pane `%266` has pid 58159, which tmux no longer has as a pane and which the OS reused for `nvim`. The old `agents.sh` hid it (pane missing) but pruned only on a dead pid, so the file stays. Resolution kept in the sidebar: hide records whose pane is missing, but delete only on a dead pid, because `tmux list-panes -a` sees one tmux server and a Pi on another server would otherwise lose its record.

## Runtime analysis

The TUIs run as separate processes in tmux panes, outside Pi's extension loader.

- **Finding the package.** A git install is a clone under `~/.pi/agent/git/…`; an npm install sits in Pi's npm directory. Before this task the operator had to hand-write `run-shell <path>/pi_session_manager.tmux`, which is how the plugin ended up unloaded. Chosen (see Install): the Pi extension knows its own path (`import.meta.url`) and, when it starts inside tmux, loads the tmux bindings itself once per tmux server. Bindings then exist whenever a Pi agent exists, with no `tmux.conf` line.
- **Node + `@earendil-works/pi-tui`.** pi-tui is a host-provided peer. Pi maps it into extensions but does not install peers for git or npm package installs, so a standalone `node sidebar.ts` cannot import it on another machine. It resolves in this checkout only through devDependencies, which would hide the defect. Using it means borrowing Pi's resolution (fragile) or running the sidebar as a Pi process (heavy). Plain Node without pi-tui means hand-written layout, scrolling, and mouse.
- **Python + Textual.** A PEP 723 script run with `uv run` installs Textual on first use; the requirement becomes `uv`, like `fzf` and `jq` today. Textual gives layout, cards, scrolling, mouse, timers, and ANSI preview rendering (Rich `Text.from_ansi`). Cost: Python becomes a production language in the repo (today only skill references and ledger checks are Python) and needs its own test lane (Textual's `Pilot`).

## Acceptance criteria

Phase 1:

- With N live root Pi panes, the sidebar lists exactly those N agents; stale state (dead pid or missing pane) never appears, and records with a dead pid are deleted.
- Each agent shows a distinguishing name without manual `/name` after its first turn, and its ledger task when one is linked.
- With the sidebar on, switching window or session moves the one sidebar pane into the new current window without taking focus; `prefix + u` turns it on and off; no `tmux.conf` line is needed once a Pi agent has started in tmux.
- The fzf picker, launcher, and bell relay, with `fzf`/`jq` requirements and their options, are gone from code, docs, and tests.
- An agent that settled while unfocused shows as needing attention until its pane is focused; a `waiting` agent shows as needing attention until its prompt resolves.

Later phases:

- One key jumps to the agent that has needed attention longest.

## Current State

In progress: phase 1 implemented and checked; not committed; not yet tried by the operator in the live tmux server.

- Built: `components/tmux-sessions/sidebar/` (production sidebar and its pytest suite), `scripts/sidebar.sh` and `pi_session_manager.tmux` (toggle, follow hooks, seen stamping, first-run baseline), plugin self-loading in `src/index.ts`, removal of the picker, launcher, and bell relay, and the docs (`docs/tmux-sessions.md`, `docs/setup.md`, README, notices). Session titles are in `components/session-title/` (provisional title on the first prompt, refined after the first reply, retitled when the session adds or starts a ledger task).
- Checked: `npm run test:sidebar` (6 pass; one mutation confirmed a test fails), the tmux-sessions Vitest file, Ruff, `context_lint`; on a scratch tmux server with an attached pty client: plugin load, toggle open/close, follow on new window, window select, and session switch, `pane-focus-in` stamping, and the first-run baseline.
- Full gate passed: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` (unit, sidebar, pair, loader), `npm pack --dry-run` lists the sidebar, plugin, and session-title files.
- Remaining: operator tries it in the live tmux server (start a new Pi, or `tmux run-shell` the plugin once); session titles not yet seen against a real model or the real ledger tools; commit.

Sidebar prototype in `prototype/` (see its README for variants A Cards, B Lanes, and the cut C Pulse): Python + Textual 8.2.8 via `uv run --script`, on live data, toggled into a real full-height pane by `prototype/run.sh`. Its default is the merged "Cards in lanes" (B's count and lanes with A's cards), with A and B kept for comparison. Verified in a scratch tmux session: renders on the terminal's default background (translucent Ghostty), j/k/x/v work, a fake record flipping busy to waiting to idle moves the card to the top and flashes it, toggle opens and closes the pane, ~3% CPU / 97 MB. Not verified: click-to-jump and `enter` against the operator's live client (deliberately not exercised from the agent), hover, and Nerd Font/glyph widths in Ghostty.

Verdict (operator, 2026-10-16): **Cards in lanes** wins: B's big count and lane headings with A's cards inside, a blank row under each heading. C cut. Operator verified click-to-jump live.

Textual research notes: `notes/textual-capabilities.md`.

## Outcome

Pending.

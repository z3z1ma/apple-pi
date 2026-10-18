Type: interrogation
Status: resolved
Blocked by: 01, 02, 04

# Capture and transport

## Question

How does state get from each Pi session, tmux, and the OS into the store, and what runs it?

Decide the bridge extension's job and its transport to the local runtime (socket, file, or other), what the runtime is and what starts it (one per Mac, started by the first Pi, by launchd, or by a UI), how it observes tmux and processes, incarnation and generation fencing across restarts, behaviour when the runtime or a session is down (buffering, reconciliation at start), and back-pressure from streaming. Absorbs Agent World's former Service lifetime ticket (`.ledger/202610171741-guildworld/decisions/09-service-lifetime.md`).

## Answer

Decided with the operator, 2026-10-18.

- **Runtime:** one daemon per Mac, written in Node, the only writer to the SQLite database (`node:sqlite`, built into Node; available without a flag from Node 22.19, apple-pi's minimum; SQLite 3.53 on this machine). The first bridge or view that finds no runtime starts it; one instance is guarded by its socket and a lock; it keeps running after sessions end so views keep working. Nothing is installed with launchd.
- **Transport:** a Unix domain socket under `~/.pi/agent/state`, newline-delimited JSON both ways, protected by file permissions (no tokens). Bridges, the sidebar (Python), the notch (Swift), and Agent World's Electron main process all connect the same way. Agent World's later browser mode goes through Agent World's own backend; the runtime never speaks HTTP.
- **Bridges:** an extension in every root session and every interactive child session. A child connects on its own, names its parent session, and its incarnation is the parent's process. A bridge's open connection plus heartbeats is the liveness signal; the bridge reports its own pid, pane, cwd, and git context.
- **tmux and processes:** the runtime polls `tmux list-panes -a` once a second on each live server (about 8 ms); it scans processes (about 22 ms) only when a bridge goes silent.
- **Runtime outage:** bridges keep working, reconnect, and send their full current state; the runtime records a gap event rather than inventing what it missed.
- **Work links:** which ledger task a session works on changes over time. Each time a session creates a ledger task, changes its status, or edits its files (the moments the ledger extension already detects), the bridge reports a time-stamped session-to-task link. A session's current work item is its latest link; its history is all links in order. This holds for workers and coordinators alike; mailed work without a task shows as no linked task. It replaces the coordinator-thread convention from [The state model](04-the-state-model.md).

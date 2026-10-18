Type: interrogation
Status: resolved
Blocked by: 05, 06

# Consumers and migration

## Question

How does every apple-pi consumer move onto the model in one clean switch?

The operator decided that the model replaces apple-pi's runtime state, with no compatibility layer (see the map's Notes). Decide the read interface (a local API, a subscription stream, direct SQLite reads, or a mix) and the command path for each consumer: the sidebar, dashboard, status line, jump key, notch (including its preferences), mailbox (`mailbox_send`, `pi-send.mjs`, delivery), subagent views, coordinator skill, and later Agent World. List what is deleted (tmux JSON records, `agents.py` commands, `@pi_seen_at`, mailbox JSONL files, `notch.json`) and what each consumer gains.

## Answer

Decided with the operator, 2026-10-18, choosing the simplest option throughout.

- **Reading:** the Textual sidebar and dashboard and the Swift notch read the SQLite file directly, read-only, and re-read it when it changes. Pi extensions use their session's own bridge connection. There is no CLI and no separate query API.
- **Writing:** the runtime stays the only writer. A view that changes something (mark seen, a notch preference, a reply) sends one JSON line over the socket.
- **tmux glue:** the runtime writes the status-line summary into tmux when state changes; it marks a session seen when its pane is the one a client shows (from the once-a-second `list-clients` poll), so no focus hook is needed; it keeps a tmux option naming the pane that has waited longest, and the jump key switches to it.
- **Mail and discovery in every root session:** every root Pi session keeps the mail tool (`mailbox_send` today) and gains a discovery tool that lists live peer sessions from the model (id, name, directory, status, who it reports to, current ledger task), both through its own bridge. Sessions can find and mail each other with or without a coordinator; the operator has seen useful self-organization across the machine from exactly this. Tool descriptions keep peer sessions (separate, long-lived Pi sessions in tmux, reached by mail) distinct from subagents (children a session starts and owns with `agent`).
- **Coordinator:** the coordinator is a Pi session with the `coordinator` skill. A coordinator extension adds only what is specific to coordinating: starting, reopening, and closing sessions, through that session's bridge. No raw `tmux new-window`, no `agents.py list`.
- **In-session views** (the `/work` panel, the input editor): unchanged; they read their own process's state.
- **Deleted in the switch:** the tmux JSON records, `agents.py` and its `list`, `feed`, `summary`, and `next` commands, the `@pi_seen_at` focus hook, the mailbox JSONL files and their watcher, and `notch.json`.

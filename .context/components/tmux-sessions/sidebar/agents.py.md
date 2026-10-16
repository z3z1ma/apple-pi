## symbol:live

Delete a state record when its pid is dead, or when its pane is missing and its `tmuxSocket` is this tmux server's socket. A record whose pane is missing on another server, or that has no `tmuxSocket`, is skipped, not deleted.
Why: `list-panes -a` sees only the reader's own tmux server, so a missing pane proves nothing about another server's Pi. On the record's own server it proves the Pi is gone, including a SIGKILL'd Pi whose pid the OS has reused.
Coupled: components/tmux-sessions/src/state.ts

An idle agent whose pane is focused in a client counts as seen, and the read stamps `@pi_seen_at` for it.
Why: an agent that settles while you watch its pane gets no `pane-focus-in` event, so without this it would sit in NEEDS YOU after you saw it finish.
Coupled: components/tmux-sessions/scripts/sidebar.sh, components/tmux-sessions/pi_session_manager.tmux

`live()` reads only state records and tmux, and the module imports only the standard library.
Why: tmux hooks run `agents.py summary` and `next` through `uv run --no-project python`, without Textual installed, on every focus change; reading session logs or importing Textual there would be slow or fail.

## symbol:AgentStore.poll

Read positions of sessions that ended are dropped on every poll.
Why: the sidebar and dashboard run around the clock; keeping one `SessionLog` per session ever seen would grow without bound.

## symbol:SessionLog._fold

Cost adds both top-level `usage` entries and assistant-message usage.
Why: top-level `usage` entries are separate requests (forked continuations, cache warming) with their own cost, not copies of a message's usage.

## symbol:Agent.name

The name never comes from prompt text. Order: Pi session name, then the linked ledger task title, then the project directory.
Why: the sidebar is always on screen; raw prompts can expose sensitive request text.

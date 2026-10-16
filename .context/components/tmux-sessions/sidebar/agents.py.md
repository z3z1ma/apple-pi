## symbol:AgentStore.poll

Delete a state record only when its pid is dead. A record whose pane is missing from `tmux list-panes -a` is skipped, not deleted.
Why: `list-panes -a` sees only the sidebar's own tmux server. A live Pi on another server, or a failed `tmux` call, would otherwise lose its record. A reused pid with a missing pane therefore stays on disk.
Coupled: components/tmux-sessions/src/state.ts

An idle agent whose pane is focused in a client counts as seen, and the poll stamps `@pi_seen_at` for it.
Why: an agent that settles while you watch its pane gets no `pane-focus-in` event, so without this it would sit in NEEDS YOU after you saw it finish.
Coupled: components/tmux-sessions/scripts/sidebar.sh, components/tmux-sessions/pi_session_manager.tmux

## symbol:SessionLog._fold

Cost adds both top-level `usage` entries and assistant-message usage.
Why: top-level `usage` entries are separate requests (forked continuations, cache warming) with their own cost, not copies of a message's usage.

## symbol:Agent.name

The name never comes from prompt text. Order: Pi session name, then the linked ledger task title, then the project directory.
Why: the sidebar is always on screen; raw prompts can expose sensitive request text.

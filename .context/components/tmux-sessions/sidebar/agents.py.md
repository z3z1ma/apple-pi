## symbol:live

A record is this server's agent only when its pane exists here with the same `paneTty`. A record whose `tmuxSocket` names another server is skipped before its pane is looked up. Only a record whose `tmuxSocket` is this server's may be deleted for a missing pane; a record without `tmuxSocket` (written by a Pi from before the field) is skipped and left alone. A dead pid always deletes.
Why: pane ids are per server and collide across servers, so another server's `%3` would otherwise show, and take dashboard replies for, the wrong pane. Treating records without `tmuxSocket` as local once let a scratch tmux server delete every live agent's record. A missing pane on the record's own server does prove the Pi is gone, including a SIGKILL'd Pi whose pid the OS has reused.
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

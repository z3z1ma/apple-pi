## symbol:AgentStore.poll

Delete a state record only when its pid is dead. A record whose pane is missing from `tmux list-panes -a` is skipped, not deleted.
Why: `list-panes -a` sees only the default tmux server. A live Pi on another socket, or a failed `tmux` call, would otherwise lose its record. A reused pid with a missing pane (seen: `%266`, pid reused by `nvim`) therefore stays on disk; any real pruning of it must first prove the pane is gone on the record's own server.
Coupled: components/tmux-sessions/sidebar/agents.py

Seen times persist in a scratch file (`$TMPDIR/pi-sidebar-PROTOTYPE-seen.json`). An idle agent with no seen time counts as unseen; a busy one is seeded as seen now, so it turns unseen only when it settles later.
Why: tmux has no last-focus time. Seeding idle agents as seen on startup hid completions that settled while no sidebar ran; a false "needs you" costs one glance, a missed one costs an idle agent.

## symbol:Agent.name

The name never comes from prompt text. Order: Pi session name, then linked ledger task title, then project directory.
Why: the sidebar is always on screen; raw prompts exposed request text (for example a prompt about production credentials). Generated titles are the planned fix for unnamed agents.

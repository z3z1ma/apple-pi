# 01: Notch panel runs from the component, started by hand

**What to build:** Running the tmux-sessions notch launcher (`notch.sh start`) on macOS builds the Swift shell if needed and shows the notch panel with the live pi agents. It works exactly as prototype round 5 in this task's `prototype/`: the pill, hover to expand, one room per tmux session, cycling, vibe per session, 🎲 shuffle of room and workers, drag to place, and click to focus. The page, assets and art pipeline move out of the ledger into the component. The agent feed becomes a `feed` mode of the sidebar's agent store, carrying the tmux socket, so that clicking a worker focuses its pane on that agent's own tmux server. See `plan.md` for the layout.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] On macOS with Xcode command line tools and uv, `notch.sh start` shows the pill with the live agents of the default tmux server.
- [ ] A second `notch.sh start` with unchanged Swift source does not rebuild: the cached binary's modification time is unchanged.
- [ ] Without `swiftc` on PATH, `notch.sh start` exits 0 and logs one line.
- [ ] In the live panel, hover, cycling, vibe per session, 🎲, drag and click to focus behave as in prototype round 5. A click focuses the pane on the agent's own tmux server.
- [ ] The feed mode prints one JSON line per poll with the fields the page reads, including the tmux socket. A pytest covers the waiting/done/working/quiet mapping.
- [ ] A Vitest check type-checks the Swift shell on macOS when `swiftc` exists, is skipped otherwise, and fails when the shell does not compile.
- [ ] The prototype's context files (under `.context/.ledger/202610160838-notch-agent-room/prototype/`, for the cleanup script and the room page) sit at the matching new source paths, and `context_lint` passes.

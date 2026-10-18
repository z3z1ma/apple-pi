# 16: Contract: remove the old state

**What to build:** The old file-based state is gone: the tmux JSON records and their writer, `agents.py`, and `notch.json` are deleted; `/pi-sessions` lists sessions from the model; `docs/tmux-sessions.md` and `docs/tasks.md` describe the new foundation; `AGENTS.md` maps the new modules.

**Blocked by:** 10 Mail on the model; 11 Peer discovery; 12 Coordinator lifecycle tools; 14 Sidebar and dashboard on the database; 15 Notch on the database

**Status:** done

- [x] No code writes or reads `~/.pi/agent/state/tmux-sessions/*.json`, the mailbox JSONL files, or `notch.json`, and `agents.py` no longer exists.
- [x] `/pi-sessions` lists live sessions from the database.
- [x] `docs/tmux-sessions.md`, `docs/tasks.md`, and the `AGENTS.md` architecture map describe the runtime, bridge, and database, and no longer describe the deleted formats.
- [x] `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:sidebar`, and `npm run pack:check` pass, and the package list includes the new modules.

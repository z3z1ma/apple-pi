## file

This API owns operator-created embedded shells, not Go to its terminal (the existing tmux navigation). The renderer supplies the creation identity before launching, so its listener can route initial output even when output precedes the create reply. The returned canonical cwd is the session's seed directory, not a claim about its shell's current working directory after commands run.

Dimensions are positive integers representable by POSIX winsize's unsigned-short rows/columns. The 0xffff check is that protocol domain, not a session/output budget. Extra request fields do not become native launch options: the IPC adapter constructs the accepted fields explicitly.
Coupled: apps/agent-world/src/backend/embedded-terminal.ts, apps/agent-world/src/electron/terminal-ipc.ts, apps/agent-world/src/electron/preload.ts, apps/agent-world/web/workplace-terminal.tsx
Verify: apps/agent-world/tests/embedded-terminal.test.ts, apps/agent-world/tests/world-terminal.test.ts

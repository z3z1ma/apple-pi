## file

One main-process collection owns only shells created by the operator's embedded-terminal API. It does not contact the session runtime, create Pi people, attach to existing tmux panes or introduce another process daemon. Creation validates a real absolute directory, retains the identity until explicit close, and launches the operator's configured shell as login plus interactive, so macOS .zprofile initializes the expected PATH even after LaunchServices startup. Tests isolate HOME/ENV/SHELL and ZDOTDIR to avoid user startup files. The new PTY omits only TMUX, TMUX_PANE, TERM_SESSION_ID and TERM_PROGRAM_VERSION from the launching terminal and identifies TERM_PROGRAM as apple-pi; ordinary PATH/auth/config environment remains inherited.

closeAll is reusable after committed renderer navigation or renderer death; dispose additionally removes listeners at application exit. PTY.kill uses normal terminal hangup semantics. Normal foreground jobs terminate with the shell; deliberately detached/nohup jobs may survive, as with an ordinary terminal. The operator explicitly rejected descendant-PID scavenging because it races PID reuse and crosses that ownership distinction.

The installed @lydell/node-pty package is a runtime dependency and must remain external in Electron's Vite build. The native addon was proven on macOS arm64 with Electron44.9.0, Node24.22.0, modules149/NAPI10; ordinary Node tests alone do not prove another Electron ABI or platform.
Coupled: apps/agent-world/src/terminal.ts, apps/agent-world/src/electron/main.ts, apps/agent-world/electron.vite.config.ts
Verify: apps/agent-world/tests/embedded-terminal.test.ts

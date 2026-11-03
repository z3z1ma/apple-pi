## file

Notifications fire when the agent settles, including after retries, compaction and queued follow-ups. A failed compaction can settle with an older successful assistant message still in memory; that provisional outcome stays until a later assistant response succeeds.
Why: the ask tool blocks the turn, so `agent_settled` never fires while it is pending. Notify there that Pi needs input, and do not require `ctx.isIdle()`, which is false mid-turn. The ask event blocks the tool pipeline until the handler resolves, so delivery must not be awaited. Event handlers also participate in settlement, so delivery continues independently of them.

`$TMUX` is `<socket>,<pid>,<session>` inside a tmux client. The click runs later in a launchd context with no `$TMUX` and a minimal `PATH`, so the stored command bakes the absolute tmux binary and server socket. Resolve that binary from `PATH` first.
Why: the tmux client must match the running server's protocol. Hardcoded candidates are only a last resort and must not win over the binary that started the server.

Focus detection fails open. A notification is suppressed only when Ghostty is frontmost and the pane's tmux window is the active window of an attached session. `/notify-test` always delivers.

A program-owned temporary person's routine completion belongs to its waiting caller, so only that completion path is quiet. Keep operator-input notifications active: suppressing the whole extension for temporary people would hide a question that blocks the program. Lasting sessions keep their ordinary notification behavior.

Coupled: components/session-state/src/protocol.ts, components/tmux-sessions/src/index.ts
Verify: components/notify/tests/notify.test.ts

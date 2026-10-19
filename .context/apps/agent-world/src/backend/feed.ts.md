## symbol:feedLine

Only events the operator follows become lines: incarnations starting and ending (not `superseded`, which a reopen's own start covers), a run back to `idle` not from `compacting` (the runtime's definition of a settle), prompts opening and closing, mail, and commands with labels. `mark_seen`, `set_preference`, tools, facts, and tmux are never lines, and child sessions (subagents) are skipped.
Why: the chatbox must stay calm; Agent World itself sends `set_preference` to remember wings, and the runtime marks sessions seen from tmux focus, so including either would flood it.
Coupled: components/session-state/src/runtime.ts, apps/agent-world/web/overlay/interface/chatbox.tsx
Verify: apps/agent-world/tests/backend.test.ts

`command_applied` and `command_failed` carry only the command id, so the command's kind is looked up in `commands`.
Coupled: components/session-state/src/runtime.ts

# Retrospective

- Forked continuations run tools through the parent's hooks, so `ctx.sessionManager` there is the parent's session. Any hook that judges "what the model has seen" must read `forkMessages()` first, or a fork can never satisfy its own gate.
- `buildSessionProjection().messages` is the right effective-context source in a session: it follows the branch and drops compacted entries, and a previous turn's tool results are already in it at the next `tool_call`.
- Counting markers only in `read`/`edit`/`write` results keeps compaction summaries and quoted text from faking delivery.

# 01: Forks bound to their own worktree

**What to build:** A forked continuation can run bound to a separate git worktree and a role. Inside it, every tool acts on the worktree, while the request the model sees stays identical to the parent's up to the fork point (spec I4, I5, sections 8.3 and 8.5). The caller chooses the conversation the fork starts from and the one message appended after it, and gets back the fork's final conversation, its usage, and a way to abort it. Argument remapping and tool blocking go in the fork's own tool hook; bash takes its working directory from the fork context (spec section 15 findings). Change review and learning reflection keep their current behavior.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Two worktree forks run at the same time and write the same relative path with different content; each worktree holds its own content and the parent workspace file is unchanged.
- [ ] A bash command in a worktree fork runs with the worktree as its working directory, and a command that names the parent's absolute path writes into the worktree.
- [ ] A write or edit to a path outside the worktree and outside the OS temp directory fails with "Branch search isolates this attempt to its own copy of the repository."
- [ ] A tool blocked for the fork's role returns "This tool is not available inside a branch search attempt.", and the fork's request lists the same tools as the parent's.
- [ ] With a recording provider stub, a fork's first request holds the parent's system prompt, tools, and messages up to the fork point, followed only by the appended message. A fork started from a conversation that ends in a pending tool call, with a tool result appended, matches the parent's next request up to that assistant message.
- [ ] Aborting one worktree fork ends it with stop reason `aborted`, while a sibling fork completes and the parent stays idle.
- [ ] `inForkedContinuation()` is true inside worktree forks, and the existing change review and learning reflection tests pass unchanged.
- [ ] The forked-continuations documentation describes the worktree binding, roles, starting conversation, and returned handle.
- [ ] Worktree fork usage is recorded with cache read tokens. On a real Anthropic session, the first worktree-fork request shows a cache read above zero (manual check; record the result in `task.md`).

# Forked continuations

A forked continuation is how the harness runs a passive, automatic prompt without continuing or steering the main run. Change review and the automatic learning reflection, shown as `Change review:` and `Reflection:`, are its two consumers. Prompts and commands that the user starts, such as `/reflect` and `/distill`, stay in the main conversation.

## Behavior

- After a run fully settles (Pi's `agent_settled`), the consumer starts a headless fork of the live conversation. The fork is the same conversation: the same system prompt, tool loadout, model, thinking level, provider session ID (prompt cache key), and messages. The consumer's prompt is added at the end. Its provider requests therefore share the parent's cached prefix.
- The fork runs the parent's tools through the parent's hooks, so the search root guard and RTK rewriting still apply. Its file edits and notebook updates are real. `ask_user_question` is blocked because no user is present.
- The fork writes nothing to the parent transcript. Its tool calls do not count as changes or evidence for the parent's change and learning reflections.
- When the fork finishes, its one-line reply becomes one custom message in the parent session, shown as one line in the chat (expand it to read the full text). The message does not start or steer a turn. When the parent is idle, it is appended at once and the model sees it on the next turn. When a run is streaming, it is appended at the end of the current turn, and the model sees it on its next request.
- The editor status shows `reflecting…` while a fork runs. If a fork fails, a warning appears and no message is added.
- Forks of the same kind can run at the same time. Starting a new session, switching session, or moving in the session tree cancels all running forks.

## Limits

- Pi gives extensions no handle on their `AgentSession`, so the harness records each session when it receives a prompt through `AgentSession.prompt`. A session that has never received a prompt cannot fork.
- The fork has no runtime of its own. Pi has no detached session clone, so the fork reuses the parent's tools, extension hooks, UI, and services. The request is identical, but every tool and hook acts as if it ran in the parent session. A tool that reads the session (such as `update_notebook`) sees the parent branch, not the fork's messages. Subagents or tasks a fork starts appear in the parent's work panel. This sharing is intended for file edits and notebook updates.
- The fork does not use the parent's request preparation. It does not compact automatically, does not route virtual models, and does not retry automatically. A fork request also replaces the parent's pending Pi cache-warming run until the parent's next request.
- A fork that edits files runs at the same time as any new user run. Edits to the same file can conflict.

## Worktree forks

Branch search needs forks that work on their own copy of the repository. `startFork(session, request)` starts one fork and gives the caller control of it:

- `messages` is the conversation the fork starts from: the parent's projection, an earlier fork's conversation, or the parent's projection that ends in a pending tool call.
- `append` is the one message added after it: a custom prompt, or a tool result for that pending call. The request is the parent's request with only this message added, so it shares the parent's cached prefix.
- `worktree: { root, parentRoot }` binds the fork to a worktree. Before the parent's hooks run, the fork's own tool hook resolves relative paths against the worktree, changes paths under the parent root to the worktree, gives `ls`, `grep`, and `find` the worktree when they have no path, and changes the parent root in bash commands to the worktree. Bash runs with the worktree as its working directory. A `write` or `edit` whose target, with symlinks resolved, lies in the parent workspace outside the worktree, or outside both the worktree and the temp directory, fails with `Branch search isolates this attempt to its own copy of the repository.` The fork's transcript keeps the model's original arguments. A shell command can still reach the parent workspace indirectly; this is a guard, not a sandbox.
- `blockedTools` names tools that return `This tool is not available inside a branch search attempt.` The tool list in the request stays the same, so the prefix stays the same.
- `label` names the fork's usage entries in the parent session.

The returned handle has `result`, a promise of the fork's final messages and the usage of each reply, and `abort()`, which stops only that fork. An aborted or failed fork resolves with its messages; the caller reads the last stop reason.

## Adding a consumer

The implementation is `components/shared/src/forked-continuation.ts`, with the fork scope in `components/shared/src/fork-context.ts`. Call `registerForkedContinuation(pi, customType, label)` once when the extension registers. It returns a function that starts a fork with a prompt, usually from an `agent_settled` handler. If the consumer tracks the main run's tool activity, skip events while `inForkedContinuation()` is true. Before you add a consumer, check that its prompt is safe with the shared tools and hooks described in Limits.

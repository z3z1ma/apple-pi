# Change reflection

Change reflection asks the main agent to look once more at the files it changed before a run finishes. The prompt uses one lens for each kind of file:

- **Code and other non-prose files:** Is there a simpler way to preserve the required behavior and fit the surrounding code? The prompt also lists what ran after each file's last change: `bash` commands, `pi_exec`, `agent`, and `get_subagent_result` calls, with failures marked. The extension does not decide which runs count as checks. The agent claims only what those runs check, runs what is missing, or says what stays unverified.
- **Prose (`.md`, `.mdx`, `.markdown`, `.txt`, `.rst`, `.adoc`):** Can the intended reader understand the purpose, terms, and next steps without this conversation?

The agent applies a clear improvement and revalidates what it affects, or keeps the result. Leaving the change as it is counts as a valid outcome.

## Behavior

- The extension records each path that a successful `edit` or `write` tool call changes during a run.
- At Pi's `agent_before_settle` boundary, if the run completed and changed files, the extension appends one visible `change-reflection` message. This message lists those paths and continues the run once.
- Edits made while the agent reflects do not trigger a second reflection. The next run that changes files starts a new reflection.
- Aborted or failed runs, runs without successful `edit`/`write` calls, and failed tool calls do not trigger a reflection.

## Scope

The extension loads only in the root session. Interactive subagents and `pi_exec` workers do not load it.

Only the built-in `edit` and `write` tools count as changes. Files changed by `bash`, subagents, or `pi_exec` do not trigger a reflection.

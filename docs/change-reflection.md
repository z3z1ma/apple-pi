# Change reflection

After a run that changed files, change reflection looks once more at those files in a [forked continuation](forked-continuations.md): a headless fork of the conversation. The main run does not continue. The prompt uses one lens for each kind of file:

- **Tests (files under `test/`, `tests/`, or `__tests__/`, and `*.test.*`, `*.spec.*`, `*_test.*`, `test_*.py`):** Does each changed test assert observable behavior the user wants now, through the public surface, and fail if that behavior broke? The agent rewrites or deletes tests that assert an abandoned direction, an implementation detail, or the absence of something nobody would build. If the conversation leaves the wanted behavior unclear, it names the mismatch and asks the user. The prompt lists what ran after each test file's last change, as for code. Test files get only this lens.
- **Other code and non-prose files:** Is there a simpler way to preserve the required behavior and fit the surrounding code? The prompt also lists what ran after each file's last change: `bash` commands, `pi_exec`, `agent`, and `get_subagent_result` calls, with failures and background launches marked. The extension does not decide which runs count as checks. The agent claims only what those runs check, runs what is missing, or says what stays unverified.
- **Prose (`.md`, `.mdx`, `.markdown`, `.txt`, `.rst`, `.adoc`):** Can the intended reader understand the purpose, terms, and next steps without this conversation?

The fork applies a clear improvement and revalidates what it affects, or keeps the result. Leaving the change as it is counts as a valid outcome. Its one-line reply, such as `Change reflection: Simplified parseArgs; npm test passes.`, reaches the main conversation as one passive message.

## Behavior

- The extension records each path that a successful `edit` or `write` tool call changes during a run.
- When the run settles (`agent_settled`), if it completed and changed files, the extension starts one fork with those paths. Its reply arrives as one `change-reflection` message.
- Edits made by the fork do not trigger a second reflection. The next run that changes files starts a new reflection.
- Aborted or failed runs, runs without successful `edit`/`write` calls, and failed tool calls do not trigger a reflection.

## Scope

The extension loads only in the root session. Interactive subagents and `pi_exec` workers do not load it.

Only the built-in `edit` and `write` tools count as changes. Files changed by `bash`, subagents, or `pi_exec` do not trigger a reflection.

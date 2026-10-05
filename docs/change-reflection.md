# Change review

After a run that changed files, change review looks once more at those files in a [forked continuation](forked-continuations.md): a headless fork of the conversation. The main run does not continue. The prompt uses one lens for each kind of file:

- **Tests (files under `test/`, `tests/`, or `__tests__/`, and `*.test.*`, `*.spec.*`, `*_test.*`, `test_*.py`):** Does each changed test assert observable behavior the user wants now, through the public surface, and fail if that behavior broke? The agent rewrites or deletes tests that assert an abandoned direction, an implementation detail, or the absence of something nobody would build. If the conversation leaves the wanted behavior unclear, it names the mismatch and asks the user. The prompt lists what ran after each test file's last change, as for code. Test files get only this lens.
- **Other code and non-prose files:** Is there a simpler way to preserve the required behavior and fit the surrounding code? The prompt also lists what ran after each file's last change: `bash` commands, `pi_exec`, `agent`, and `get_subagent_result` calls, with failures and background launches marked. The extension does not decide which runs count as checks. The agent claims only what those runs check, runs what is missing, or says what stays unverified.
- **Prose (`.md`, `.mdx`, `.markdown`, `.txt`, `.rst`, `.adoc`):** Can the intended reader understand the purpose, terms, and next steps without this conversation?

The fork applies a clear improvement and revalidates what it affects, or keeps the result. Leaving the change as it is counts as a valid outcome. Its one-line reply, such as `Change review: Simplified parseArgs; npm test passes.`, reaches the main conversation as one passive message.

## Behavior

- The extension records each path that a successful `edit` or `write` tool call changes during a run.
- When the run settles (`agent_settled`), if it completed and changed files, the extension starts one fork with those paths. Its reply arrives as one `change-reflection` message.
- Edits made by the fork do not trigger a second reflection. The next run that changes files starts a new reflection.
- Aborted or failed runs, runs without successful `edit`/`write` calls, and failed tool calls do not trigger a reflection.

## Interactive coding children

A public interactive child with active built-in `edit` or `write` tools reviews its own work before it hands off, in its own conversation rather than in a fork. This applies to nested children too, and to custom agents. Pairing does not affect it (`pair: false` keeps it), and there is no setting to turn it off. Children without those tools, the internal `/btw` and consultation sessions, internal managed runs, and `pi_exec` workers do not get it.

A real coding child launched by a primary fork still tracks its own edits and execution evidence. A fork that reuses the child's tools remains separate from that child's tracked work; workspace isolation and cancellation remain inherited.

When one invocation (a launch or a resume) completes, the child receives one instruction and keeps working before Pi settles the run:

1. **Review**, only if the invocation made a successful `edit` or `write` call. It uses the same lenses and the same list of what ran after each file's last change as the root review. When the intended behavior is unclear, the child uses `clarify` if it has it. The answer is advice, not new authorization. If the question stays open, the child leaves the disputed change alone and reports the question and the verification it affects.
2. **Learning**, after every completed invocation, with that invocation's failed or surprising tool calls as evidence. It does not wait for the root's [token spacing](context.md#pair-programmer-notebook). Additions go to the primary notebook through the child's add-only `update_notebook`. Recording nothing is a valid outcome.
3. **Final report.** This replaces the earlier report. It describes the files as they now stand, the checks that ran after the last changes, what remains unverified, the review outcome, and a brief summary of notebook additions. It also names any learning that could not be recorded and why. A rejected notebook addition on its own does not fail the child.

Each invocation gets this phase once. Edits made during the review do not start another one, and a resume starts a new invocation. The phase counts toward the child's usual turn limit and follows its usual cancellation. The caller sees the result only after the phase finishes. If the phase fails, is stopped, or reaches the turn ceiling, the child is reported as failed, stopped, or aborted like any other run. Its changed files are kept, and the handoff says that the completion review did not finish, so an earlier report is never presented as reviewed. There is no extra notification to the root.

## Scope

The passive fork described above loads only in the root session. Interactive coding children run the in-band phase described above. `pi_exec` workers get neither.

Each session tracks only its own successful built-in `edit` and `write` calls. Changes made through `bash` or `pi_exec` are outside that tracker. A subagent's edits do not trigger the primary's passive review; eligible coding children review their own tracked edits through the in-band phase.

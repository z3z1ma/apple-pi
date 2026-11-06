## file

`replay_rule` evaluates a rule (an existing one by id, or a candidate) against what agents actually did here: a GritQL rule or edit script against the text each recorded `edit` added (every `newText`) and each `write`'s content, an action pattern against recorded `bash` commands, or a call script against every recorded call with its whole recorded batch, in sessions whose working directory is this repository, from `since` on. It calls the engines (`runRules`, the regular expression, `runScripts`) directly, never the engine's `checkCall`/`checkEdit`, so a replay records no firings; a job an engine cannot run is listed as not evaluated, never counted as allowed. Edit scripts see `content` as `null`, since the file as it stood is not recorded.
Why: a rule's evidence is what it would have refused in real work, and the firing counts `repo_rules` reports must stay counts of real refusals. Checking only added text matches the mistake being made, not violations already in the file, which the live check (whole file) would also flag; a match spanning text outside the edit is missed.

`since` is explicit (a date or a revision, resolved to its commit time) and the report states it.
Why: usage before the last change to what a rule guards describes an older harness (operator correction, 2026-11-05); the caller picks the window rather than a default spanning old behaviour.

Calls made from codemode scripts are recorded as the script's tool result, not as tool calls, so they are not replayed. A replay over this repository's sessions since 2026-11-04 (four sessions, 1,414 shell commands) took 1.4 seconds and found the refused `gh pr comment` that led to `github-writes`.
Recorded paths resolve as the live tools resolve them (`resolveToolPath`: `@`, `~`, `file://`); only the directory is made canonical for repository membership, so a symlinked file keeps the name the live `includes` match sees. Edits are read in every shape the edit tool accepts (`edits` as an array, a JSON string or one object, and legacy top-level `oldText`/`newText`); an edit whose arguments cannot be read is listed as not evaluated with the reason. GritQL jobs run whenever the pending added text reaches `REPLAY_BATCH_BYTES` (8 MiB) and at each session file's end: a memory bound with no effect on results, chosen to keep one engine process per many edits. Each item carries its session file, because `search_session` may refuse another person's entry.

Paths match a candidate's `includes` with `includedBy`, the same function the live check uses for `policy.json` rules, so a replay and the adopted rule cover the same files.

Coupled: components/repo-rules/src/events.ts, components/repo-rules/src/scripts.ts, components/repo-rules/src/policy.ts, components/shared/src/session-logs.ts, components/repo-rules/src/grit.ts, components/system-prompt/src/toolbox.ts, tests/package-load.mjs
Verify: components/repo-rules/tests/replay.test.ts

## file

`replay_rule` evaluates a candidate rule against what agents actually did here: a GritQL rule against the text each recorded `edit` added (every `newText`) and each `write`'s content, or an action pattern against recorded `bash` commands, in sessions whose working directory is this repository, from `since` on. It calls `runRules` and the regular expression directly, never `editRefusal`/`commandRefusal`, so a replay records no firings; a job the engine cannot run is listed as not evaluated, never counted as allowed.
Why: a rule's evidence is what it would have refused in real work, and the firing counts `repo_rules` reports must stay counts of real refusals. Checking only added text matches the mistake being made, not violations already in the file, which the live check (whole file) would also flag; a match spanning text outside the edit is missed.

`since` is explicit (a date or a revision, resolved to its commit time) and the report states it.
Why: usage before the last change to what a rule guards describes an older harness (operator correction, 2026-11-05); the caller picks the window rather than a default spanning old behaviour.

Calls made from codemode scripts are recorded as the script's tool result, not as tool calls, so they are not replayed. A replay over this repository's sessions since 2026-11-04 (four sessions, 1,414 shell commands) took 1.4 seconds and found the refused `gh pr comment` that led to `github-writes`.
Coupled: components/shared/src/session-logs.ts, components/repo-rules/src/grit.ts, components/system-prompt/src/toolbox.ts, tests/package-load.mjs
Verify: components/repo-rules/tests/replay.test.ts

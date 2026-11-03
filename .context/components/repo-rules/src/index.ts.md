## file

The harness checks a repository only when `.pi/rules/` exists above the edited file or the shell's cwd; elsewhere every edit and command passes untouched.
Why: rules and the comment ban are opt-in per repository (operator decision, 2026-11-03).

The prompt section always appears. In an opted-in repository it teaches the rules and asks for new ones liberally. Elsewhere it names the capability and has the agent offer `.pi/rules/` to the user rather than create it.
Why: the operator wants rules created liberally in every repository, but rules are committed for everyone who works there, so opting in stays a human choice.

Refusals are recorded per repository and rule in `~/.pi/agent/repo-rules/firings.jsonl` (`firings.ts`), outside the repository, and `repo_rules` reports them.
Why: counts go stale and are personal, so committing them would churn the repository; the report needs only this machine's history.

A commit beside an edit is detected from `message_end`: the assistant message lists every tool call of its parallel batch, so the hook remembers the batch's call ids when any of them is `edit` or `write` and refuses a `git add`/`git commit` among them. This holds in every repository, opted in or not. It relies on Pi ending the assistant message before it runs that message's tool calls, and the remembered set is cleared at each assistant `message_end`, so only the latest batch counts.
Why: parallel calls run concurrently, so such a commit took the files before the edits landed.

Edits are checked against the content the edit tool would produce (`proposedContent`); when the edit would fail anyway (text missing or not unique), the hook returns nothing and lets the tool report its own error. Calls with `parentToolCallId` (inside `pi_exec`) are not checked.
Coupled: components/repo-rules/src/policy.ts, .pi/rules/policy.json, components/notebook/src/distillation.ts, skills/code-review/SKILL.md, lint/README.md
Verify: components/repo-rules/tests/repo-rules.test.ts

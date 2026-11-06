## file

Repository-specific rules check a repository only when `.pi/rules/` exists above the edited file or the shell's cwd. The parallel-batch guard applies everywhere. Runtime guidance teaches both the universal batch contract and the repository's opt-in state.
Why: rules and the comment ban are opt-in per repository; dependent parallel calls are unsafe in every repository.

At tool_call, `executingBatch` finds the current call's finalized assistant message in the fork's own conversation or the root's compaction-aware projection. It retains no shared batch snapshot. Same-path reads and literal-path shell calls are refused, as are every writer in a same-path write collision. The existing git staging/commit check uses that same executing batch.
Why: a message_end snapshot can miss later message replacements, and a fork forwards tool hooks without forwarding its assistant message_end events. The fork/session projection distinction is already owned by `fork-context` and used by code-context.

Refusals do not depend on whether a sibling edit has started, succeeded or been blocked by another hook. A refused check can leave its sibling edit applied. Nested calls skip the batch and content checks because their ordering belongs to the script; nested Bash calls still reach action rules.
Why: repeatedly batching a check with its edit read old files even after the commit-only guard and parallel-calls lesson existed.

Repository-rule refusals are recorded per repository and rule in `~/.pi/agent/repo-rules/firings.jsonl` (`firings.ts`), outside the repository; `repo_rules` reports them. Batch-guard refusals remain observable through session error results rather than being repository-rule firings.
Why: rule counts are this machine's history; committing them would churn the repository.

Edits are checked against the content the edit tool would produce (`proposedContent`); when the edit would fail anyway (text missing or not unique), the hook leaves the tool to report its own error.
Coupled: components/repo-rules/src/batches.ts, components/repo-rules/src/policy.ts, components/shared/src/fork-context.ts, .pi/rules/policy.json, components/notebook/src/distillation.ts, skills/code-review/SKILL.md, lint/README.md
Verify: components/repo-rules/tests/repo-rules.test.ts, components/repo-rules/tests/batches.test.ts, components/repo-rules/tests/batch-host.test.ts

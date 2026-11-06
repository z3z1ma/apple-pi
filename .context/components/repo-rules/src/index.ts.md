## file

The extension hard-codes no policy. Every check comes from a rules directory: `.pi/rules/` above the cwd or edited file, and the person's `~/.pi/agent/rules/`. Without either, nothing is checked and the prompt only offers rules.
Why: the operator (2026-11-06) rejected baking an adopted lesson (the dependent-batch guard) into harness code; lessons are model- or human-authored configuration a repository or person owns. When a lesson cannot be written as a rule, extend what rules see (the event in `events.ts`), not the hook.

At tool_call, `executingBatch` finds the current call's finalized assistant message in the fork's own conversation or the root's compaction-aware projection, and gives it to call scripts as `batch`. It retains no shared batch snapshot.
Why: a message_end snapshot can miss later message replacements, and a fork forwards tool hooks without forwarding its assistant message_end events. The fork/session projection distinction is already owned by `fork-context` and used by code-context.

Every call goes through `checkCall`, which also checks a top-level `edit`/`write` as an edit and reports all refusals together. Nested calls (`parentToolCallId`, from codemode scripts) skip edit checks and see a batch of only themselves, because their ordering belongs to the script; they still reach action rules and call scripts.

Refusals do not depend on whether a sibling call has started, succeeded or been blocked by another hook. A refused check can leave its sibling edit applied.
Coupled: components/repo-rules/src/engine.ts, components/repo-rules/src/events.ts, components/shared/src/fork-context.ts, .pi/rules/policy.json, components/notebook/src/distillation.ts, skills/code-review/SKILL.md, lint/README.md, docs/repo-rules.md
Verify: components/repo-rules/tests/repo-rules.test.ts, components/repo-rules/tests/batches.test.ts, components/repo-rules/tests/batch-host.test.ts

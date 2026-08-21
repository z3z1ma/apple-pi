Status: done
Created: 2026-08-15
Updated: 2026-08-15

# Work-item bootstrap and self-hosting boundary

## Question

How can gated task-local work items be introduced without allowing the currently loaded Ralph implementation to ignore them or combine new on-disk role prompts with old in-memory parsers?

## Sources

- `components/ralph/src/work-graph.ts`
- `components/ralph/src/task.ts`
- `components/ralph/src/controller.ts`
- `components/ralph/src/roles.ts`
- `components/ralph/src/receipts.ts`
- `components/ralph/src/lease.ts`
- `components/ralph/src/types.ts`
- `skills/ralph-executor/SKILL.md`
- `skills/ralph-judge/SKILL.md`
- `docs/ledger.md`
- `docs/ralph.md`

## Method

Inspected task parsing, closure gates, digest-checked mutation, task leases, role profile loading, role output parsing, receipt validation, and extension lifecycle behavior.

## Findings

- The current work-graph compiler ignores an optional Work Items section and current closure checks only acceptance evidence, dependencies, review, retrospective, and distillation. Legacy Ralph could therefore close a task while its work items remain open.
- `roleProfile()` reads executor and judge skill files from disk each time a role starts, while the Ralph controller and output parsers remain loaded in memory. Editing role skills and parser code during one Ralph run could invoke a new judge prompt against an old parser.
- Task mutation already uses queued digest compare-and-swap, and Ralph leases the canonical task bundle. Those mechanisms are the correct authority boundary for work-item updates.
- Pi `/reload` tears down the current extension runtime and loads the new controller, parser, skills, and schemas together.

## Conclusion

Implement the gated-work-item core outside Ralph, then run targeted and full validation plus independent review, mark this prerequisite done, and reload Pi before inspecting or executing any dependent task with work items. The prerequisite task itself contains no Work Items section so legacy tooling cannot misinterpret its closure contract.

## Limits

This investigation does not authorize bypassing review or tests. The bootstrap changes are production behavior and require the same authority, receipt, and closure validation as ordinary Ralph changes.

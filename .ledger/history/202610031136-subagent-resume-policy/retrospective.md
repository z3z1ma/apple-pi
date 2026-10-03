Status: complete
Created: 2026-10-03
Updated: 2026-10-03

# Retrospective

This record covers the completed implementation. See the [ledger task](task.md) for validation evidence and the closeout decision.

## What Mattered

The architecture survey found a bounded opportunity: root and nested public-subagent callers repeated the same fixed-setting comparisons. The operator chose consistent omission semantics: every omitted fixed setting reuses its stored choice. Previously, omitted `inherit_context` and `isolated` were treated as `false`, while the other fixed settings reused stored choices, so sessions started with either flag set to `true` could not resume without restating it.

One compatibility decision in the existing invocation-policy module hid those rules without moving ownership checks or session execution. The change fit one context, so ticket generation was skipped. Commit `69ef926` contains the policy, both callers, behavioral tests, runtime guidance, and product documentation. Both independent review axes found no material findings, and implementation-time repository checks passed.

## Learnings

- Schema default metadata is not proof of what reaches tool execution. A real Pi 0.99 preparation/execution probe showed that optional booleans with `default: false` remain absent when omitted. Root and nested integration tests now preserve this distinction through Pi's actual validator, including explicit conflicting `false`.
- Shared policy tests do not prove that every caller uses the policy. The root and nested tool regressions each established the original failure and then successful continuation, while retaining caller-owned ownership checks.
- During task preparation, persistent Pi Exec retained a loop variable's earlier literal-union type across snippets. A failed redeclaration did not make its new assignment available to the next snippet. Use a fresh variable name and initialize each retry, or reset the guest before unrelated programs.

## Improvements

The durable behavior lives in the invocation-policy module, public-tool guidance, engineering-team documentation, and executable policy/integration tests. There is no follow-up refactor, migration, adapter, or configuration mechanism to maintain.

Concurrent work briefly blocked global validation and later changed repository HEAD. Review used a pinned commit and six explicit paths; the final suite was rerun after the unrelated work settled. A later closeout rerun at `8555e2c` passed all 1,186 test cases but failed discovery/loading of a concurrently removed temporary Pi Exec test. After code edits settled, a full run at `41b1443` failed four unrelated registration/detach/abort cases, all of which passed in isolation. That focused success does not replace a green full command; full-suite timing/interference remains unresolved. The operator subsequently confirmed the scoped work is complete and directed task closure, with these later validation results retained as evidence rather than new work owned by this task. Future shared-tree work should run final validation after concurrent writers settle, retain explicit scope, and inspect the actual committed diff when a reflection updates an already-reviewed path.

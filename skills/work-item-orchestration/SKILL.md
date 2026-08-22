---
name: work-item-orchestration
description: "Use when an authorized plan contains substantial independent Work Items and delegating them provides clear context-isolation, specialization, or parallelism value."
---

# Orchestrate Work Items Economically

Subagents are expensive, high-capability collaborators. Use them deliberately and usually once per coherent problem, not as participants in an infinite implementation/review conversation.

## Decide whether to delegate

Keep work in the root session when it can be implemented coherently there. Delegate only when at least one is true:

- a substantial Work Item benefits from isolated context;
- independent domains can progress in parallel without shared writes;
- a specialist capability materially improves the outcome;
- root-context preservation is worth the handoff cost;
- the operator requests delegation.

Batch related same-owner changes into one complete brief. Subagents serve substantial assignments where their context isolation or specialization repays the dispatch cost.

## Cost rule

Assume every dispatch may consume a large model context and many tool calls. Before dispatching, ask whether the root agent can finish the work faster than preparing, waiting for, validating, and integrating the handoff. If yes, do it yourself.

## One-shot handoff

Give one implementer everything needed to complete the coherent assignment:

- the exact outcome and owned files;
- governing constraints and settled semantics;
- relevant interfaces and current repository state;
- checks to run;
- explicit non-goals;
- a concise report contract.

Use the real `Agent` tool with the appropriate type/profile, `inherit_context: false`, and no child delegation. Avoid pasting transcript history; point to authoritative files.

One agent may own multiple related Work Items when that reduces repeated context loading. Writers receive disjoint ownership.

## Root ownership

The root session remains the senior engineer. It:

- validates the worker's claims against the diff and checks;
- integrates the result;
- fixes ordinary omissions, nits, formatting, and small regressions itself;
- updates any shared plan or Ledger state;
- decides whether a reported concern is material.

The root handles routine feedback. Resume or replace a worker when it is genuinely blocked on missing context, the implementation is materially incomplete, or a distinct unresolved problem still benefits from its context.

## Review policy

Follow the plan's explicit risk tier:

- `Review: none` — root inspection and named checks are enough.
- `Review: one-pass` — commission one fresh review of the complete coherent change after implementation.
- `Review: staged` — use the smallest staged review justified by the named high-cost risk.

Per-Work-Item review is not automatic. Separate specification and quality verdicts are not automatic. Final whole-change review is not automatic.

A commissioned reviewer gets the full bounded change and all important review questions in one call. The root validates findings and fixes confirmed issues itself. Nits conclude in the root session. After a material fix, rerun the relevant tests; one scoped follow-up serves an original high risk that remains difficult to verify locally.

## Execution loop

1. Read the authorized plan and select a ready coherent batch.
2. Confirm each live writer has disjoint file ownership.
3. Decide whether delegation still beats root implementation.
4. Dispatch once when justified.
5. Inspect the actual diff and run or confirm the named checks.
6. Resolve ordinary findings directly.
7. Apply the plan's review tier.
8. Mark progress and continue without asking the operator to reconfirm.

Stop only for destructive/irreversible action, security-sensitive authority, external side effects, unresolved product meaning, or a plan too broken to execute safely.

## Failure handling

- `NEEDS_CONTEXT`: provide the missing fact once and resume if the worker remains the cheapest path.
- `BLOCKED`: investigate the blocker in the root; change the method or take over rather than retrying unchanged.
- partial implementation: preserve useful work, finish it in the root when practical, and report limits honestly.
- reviewer disagreement: decide from governing authority, code, and tests in the root.

## Completion

A batch is complete when the intended behavior is present, named checks pass, and any material risk-tier review is resolved. Keep the final report concise: changed paths, checks, material decisions, and remaining risk. Review packages or evidence records appear only when the active plan uses them for continuity.

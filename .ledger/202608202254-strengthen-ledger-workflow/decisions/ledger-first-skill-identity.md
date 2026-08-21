Status: active
Created: 2026-08-21
Updated: 2026-08-21

# Make Ledger the identity and substrate of every packaged skill

## Context

The Superpowers fusion established strong execution disciplines but left skill names as a mixture of generic upstream names and `pi-*` names. The operator observed that if every skill uses Ledger meaningfully, the public names should say so and the implementation should be grounded in a fundamental account of what Ledger is.

Research in `../research/ten-x-ledger-philosophy.md` compared apple-pi with `z3z1ma/10x` at commit `4616e5c07d6f9b82fb299ef18446280ab6f1e09d`. It found that the valuable fusion is: Superpowers supplies procedure and pressure-tested execution discipline; 10x supplies authority, provenance, operating-state separation, evidence semantics, and compounding; apple-pi supplies one Ledger state owner and authentic actuation through core tools, typed `Agent`, `pi_exec`, Ralph, and independent review.

## Decision

Every packaged skill is Ledger-prefixed and participates in the same durable workflow:

- `ledger-brainstorming`
- `ledger-writing-plans`
- `ledger-executing-plans`
- `ledger-subagent-driven-development`
- `ledger-dispatching-parallel-agents`
- `ledger-systematic-debugging`
- `ledger-test-driven-development`
- `ledger-requesting-code-review`
- `ledger-receiving-code-review`
- `ledger-verification-before-completion`
- `ledger-using-git-worktrees`
- `ledger-finishing-a-development-branch`
- `ledger-writing-skills`
- `ledger-pi-review`
- `ledger-pi-ralph`
- `ledger-pi-exec`

The prefix is a behavioral promise, not decoration. Each skill must name its Ledger state, inputs, evidence, blockers, and handoff or explain why the current action is trivial enough not to require a task mutation.

Ledger is defined as apple-pi's epistemic and execution substrate:

1. **Authority:** one task owns one outcome; active specifications and decisions establish behavior; every execution-changing assumption is record-backed, user-ratified, or blocking.
2. **Memory:** the transcript is transient; task records let a cold-start session recover goal, constraints, provenance, state, evidence, and next action.
3. **Operating state:** shaping resolves meaning, orchestration coordinates bounded owners and review, execution owns one acceptance gap or Work Item. One session may wear the roles sequentially, but must keep their responsibilities distinct.
4. **Evidence:** observations carry procedure and limits; worker reports are claims; review attempts to falsify completion; closure joins acceptance evidence, review, blockers, dependencies, retrospective, and distillation.
5. **Compounding:** discoveries become the correct durable owner, recurring toil becomes a skill, independent follow-up becomes a task, and task-specific history remains local.
6. **Proportion:** exact trivial work stays exact and avoids record ceremony; ambiguity, behavioral consequence, risk, and multi-session cost determine record depth.

Underlying runtime identifiers remain unchanged. `pi_exec`, `Agent`, `ledger_add`, and `ledger_close` are actual tools; Ralph and review procedures are exposed through `ledger-pi-ralph` and `ledger-pi-review`. No compatibility aliases or duplicate old skill directories ship because this skill surface has not yet been released.

## Authority And Provenance

- Operator instruction, 2026-08-21: implement the entire fusion, prefix all skill names with Ledger, understand Ledger fundamentally, and adapt the philosophy from the operator's `z3z1ma/10x` repository.
- `../research/ten-x-ledger-philosophy.md`
- `fusion-scope.md`
- `../../../../docs/ledger.md`

## Alternatives Considered

### Prefix only the Superpowers-derived skills

This would leave review, Ralph, and Pi Exec looking like a separate subsystem even though they consume and produce Ledger state in the same workflow. Rejected because it preserves the mixed identity the operator asked to remove.

### Keep generic names and mention Ledger only in descriptions

This minimizes renames but does not make the public catalog communicate the shared substrate. It also permits techniques to drift into isolated state and vocabulary again. Rejected.

### Add a standalone 10x or Ledger-foundations skill

This would recreate a parallel always-active methodology beside the root Ledger contract and distribute responsibility across two routing owners. Rejected. The root contract defines fundamentals; every on-demand skill applies them to its procedure.

### Rename runtime tools

Renaming `pi_exec`, `Agent`, or Ledger tools would invent APIs and break authentic actuation. Rejected. Only packaged skill identifiers change.

## Consequences

- All skill directories, frontmatter names, cross-links, root routes, documentation, tests, and package assertions change atomically.
- The root workflow marker becomes Ledger-specific and routes only to `ledger-*` skills.
- The Ledger system prompt grows from a file-format contract into the concise always-loaded statement of authority, memory, operating states, evidence, closure, and compounding.
- Superpowers and 10x both require MIT attribution at pinned commits for close textual adaptations.
- Existing users of the unreleased working-tree skill names must use the new names after restart; no duplicate aliases remain.

## Revisit Conditions

Revisit only if Pi itself reserves the `ledger-` namespace, native skill discovery cannot load the renamed directories, or empirical root-session evaluation shows the prefix materially harms correct skill selection. Any compatibility layer requires a real published migration contract.

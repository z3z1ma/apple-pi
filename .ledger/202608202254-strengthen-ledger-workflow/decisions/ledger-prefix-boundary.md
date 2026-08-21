Status: active
Created: 2026-08-21
Updated: 2026-08-21

# Prefix the incoming fused lifecycle skills, not the Pi utility skills

## Context

The first naming interpretation applied `ledger-` to every packaged skill, including the pre-existing Pi Exec, Pi Review, and Pi Ralph skills. The operator corrected that interpretation: the prefix request targets the incoming Superpowers-derived skills that supersede the old stage-local Ledger lifecycle, not independent Pi utilities. Pi Exec and Pi Review must retain their names and general-purpose contracts. Pi Ralph is Ledger-aware by its existing design but does not need a renamed public identifier.

## Decision

The 13 incoming fused lifecycle skills use the `ledger-` prefix:

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

The three pre-existing Pi skills retain their established names and responsibility boundaries:

- `pi-exec` remains general `pi_exec` guest-API and composition guidance. It is not made Ledger-specific.
- `pi-review` remains the default general code-review skill. Ledger workflow skills may invoke it with Ledger contracts, but the skill itself is not tied to Ledger.
- `pi-ralph` retains its existing name. Its existing contract continues to execute prepared Ledger tasks because that is how apple-pi Ralph already preserves inter-iteration state; no prefix alias is added.

The injected root workflow may route between the two groups, but it must describe their distinct ownership rather than imply every packaged skill is a Ledger lifecycle skill. Runtime identifiers remain `pi_exec`, `Agent`, `ledger_add`, and `ledger_close`.

## Authority And Provenance

- Operator correction, 2026-08-21: Pi Exec and Pi Review neither need the `ledger-` prefix nor changes tying them to Ledger; the prefix was intended for incoming skills that superseded the old Ledger lifecycle. Pi Ralph is the only debatable case.
- `../research/ten-x-ledger-philosophy.md`
- `fusion-scope.md`
- Supersedes `ledger-first-skill-identity.md`.

## Alternatives Considered

### Prefix all 16 packaged skills

Rejected by the operator. It conflates general Pi utilities with the incoming Ledger lifecycle and changes stable responsibilities without a need.

### Prefix Pi Ralph only

Pi Ralph is already Ledger-backed, so the name could communicate that relationship. Rejected for this implementation because the operator described it as debatable rather than required, while preserving the established name avoids unnecessary public churn.

### Keep all incoming skills unprefixed

Rejected because those skills deliberately absorb the old Ledger lifecycle and the prefix communicates their shared authority, state, evidence, and closure model.

## Consequences

- Thirteen skill directories and frontmatter names begin `ledger-`; `pi-exec`, `pi-review`, and `pi-ralph` remain unchanged.
- Pi Exec and Pi Review contain no newly added Ledger-state section. They may still be invoked by Ledger skills with task-specific inputs.
- Package and prompt tests assert the exact split and the absence of both old generic incoming aliases and accidental `ledger-pi-*` aliases.
- Documentation describes Ledger lifecycle skills separately from reusable Pi utility skills.

## Revisit Conditions

Revisit Pi Ralph naming only after an explicit operator decision or a real migration contract. Revisit Pi Exec or Pi Review only if their underlying product responsibilities change, not merely because a caller happens to use Ledger context.

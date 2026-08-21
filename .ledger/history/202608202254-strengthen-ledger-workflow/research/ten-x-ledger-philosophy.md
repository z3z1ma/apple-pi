Status: done
Created: 2026-08-21
Updated: 2026-08-21

# 10x principles for a Ledger-native skill system

## Question

Which principles from `z3z1ma/10x` should become fundamental Ledger behavior in apple-pi, and how should they alter the fused Superpowers skill topology without creating `.10x/` or a second workflow authority?

## Sources And Methods

- Inspected `https://github.com/z3z1ma/10x` at commit `4616e5c07d6f9b82fb299ef18446280ab6f1e09d` on 2026-08-21.
- Read `README.md`, `SKILL.md`, `autoresearch/README.md`, `autoresearch/program.md`, and `LICENSE` completely.
- Compared the source model with `docs/ledger.md`, `components/shared/src/ledger-system-prompt.ts`, the active Superpowers fusion specification, and the current 16 packaged skills.
- Treated source language as evidence. The operator authorized Ledger-prefixing and meaningful Ledger integration for the 13 incoming lifecycle skills, while preserving the existing Pi Exec, Pi Review, and Pi Ralph names and boundaries.

## Findings

### Impact rather than output

10x defines leverage as solving the right problem, preserving judgment, eliminating unnecessary work, and making the next decision cheaper. Its minimalism ladder is elimination, standard library, native platform, existing dependencies, then minimum viable code. This strengthens Superpowers' YAGNI and small-step execution while giving the result a durable learning loop.

### Ledger is an epistemic substrate

The useful concept behind `.10x/` is not its directory topology. It is a shared, typed record graph that distinguishes authority from evidence and chat from durable state. apple-pi already has the stronger storage boundary: one `.ledger/<task>/task.md` owns one outcome, with task-local decisions, specs, research, plans, evidence, knowledge, and candidate skills. The correct adaptation is to make every workflow skill operate on that same substrate, not add `.10x/`.

### Three operating states

10x separates:

1. shaping—the outer loop that searches prior context, resolves ambiguity, and establishes authority;
2. orchestration—selection and coordination of bounded executors and independent reviewers;
3. execution—the inner loop for one owned unit, observed evidence, blockers, and handback.

apple-pi can preserve the separation without requiring a different agent for every state. Ledger records make the current state and handoff reconstructable. Typed `Agent`, `pi_exec`, Ralph, and `pi-review` supply actuation while the root session retains orchestration and closure judgment.

### Provenance before implementation

Every execution-changing assumption should be record-backed, user-ratified, or blocking. Examples, source fields, pressure, passing tests, and polished artifacts do not create product authority. Search active and historical records before asking the operator to repay context.

### Evidence and review are different

Execution evidence proves only what was observed and within stated limits. Worker reports remain claims until checked. Independent review attempts to falsify completion rather than repeat the same verification. Closure joins acceptance evidence, review disposition, dependency coherence, blockers, follow-up ownership, retrospective, and distillation.

### Compounding is part of completion

The executor records surprises and friction while in the weeds. At meaningful iterations and closure, the controller routes durable outcomes to their real owner: repository documentation, decisions, tests, runbooks, packaged skills, or a new Ledger task. Task-specific history remains task-local. This is the mechanism by which later sessions inherit earlier judgment.

### Instructions need empirical evaluation

10x treats instructions as software: state a behavioral hypothesis, compare a current and candidate instruction in clean subject workspaces, inspect raw transcripts and resulting files, record limits, and require human promotion. apple-pi's existing root-session baseline/treatment design is the matching owner. The reusable principle belongs in the Ledger skill-authoring procedure; the 10x Python harness is not imported.

## Translation To apple-pi

| 10x concept | apple-pi owner |
| --- | --- |
| Always-active project method | Root Ledger workflow prompt plus injected Ledger contract |
| `.10x/` record graph | One task-local `.ledger/<task>/` bundle and live/history indexes |
| Ticket | `task.md`; Work Items are implementation decomposition, not separate tickets |
| Outer loop | `ledger-brainstorming`, `ledger-writing-plans` |
| Orchestration | `ledger-executing-plans`, `ledger-subagent-driven-development`, `ledger-dispatching-parallel-agents`, `pi-exec`, `pi-ralph`, `ledger-requesting-code-review`, `pi-review` |
| Inner loop | Debugging, TDD, direct execution, and Ralph procedures operating on one Work Item or acceptance gap |
| Evidence/review/retro | Canonical sections in `task.md`; standalone evidence only when an observation outlives a routine check |
| Knowledge/skills | Task-local `knowledge/` and `skills/`, distilled to normal repository owners or packaged `ledger-*` skills |
| Autoresearch | Baseline/treatment skill evaluation with clean root Pi sessions and durable Ledger evidence |

## Conclusions

- Prefix the 13 incoming Superpowers-derived lifecycle skill names and directories with `ledger-`. The prefix signals that they absorb the former Ledger stages and share one authority, provenance, evidence, and learning system.
- Preserve the established `pi-exec` and `pi-review` names and general contracts; Ledger lifecycle skills may invoke them with task context without redefining them. Preserve `pi-ralph` under its existing name and prepared-Ledger-task contract.
- Strengthen the injected Ledger contract with the three operating states, provenance classes, search-before-shaping, evidence semantics, closure definition, compounding, and proportional minimalism.
- Give each fused lifecycle skill a specific Ledger role rather than copying one generic paragraph everywhere.
- Preserve Superpowers' procedure bodies, pressure tests, rationalization counters, and examples; use 10x as the authority/context substrate underneath those execution disciplines.

## Limits

- This research did not run 10x's autoresearch harness or import its Python tooling. The operator asked for philosophical adaptation, and apple-pi already owns its runtime and evaluation boundary.
- The source's separate `.10x/` hierarchy, parent tickets, and categorical prohibition on implementation in the same turn are not copied. Ledger's one-task bundle, proportional ceremony, explicit authorization, and current operator-approved task remain authoritative.
- External GitHub contents may change after the inspected commit; this record is pinned to the revision above.
- The initial all-skills prefix conclusion was corrected by the operator on 2026-08-21; `decisions/ledger-prefix-boundary.md` is the naming authority.

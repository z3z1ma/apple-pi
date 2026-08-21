Status: done
Created: 2026-08-20
Updated: 2026-08-20

# Superpowers main methodology and Ledger fit

## Question Or Hypothesis

Can the complete portable methodology of `obra/superpowers` improve apple-pi's Ledger lifecycle without creating a second workflow runtime, undermining Ledger authority, or reintroducing architecture that apple-pi deliberately removed?

## Motivation

The operator identified a likely fit between Superpowers' structured development workflow and apple-pi's Ledger, Ralph loops, typed subagents, Pi Exec, independent review, Advisor, and durable task records. The answer determines whether to change stage-local skills, add runtime machinery, or retain the current workflow.

## Sources And Methods

- Upstream checkout: `https://github.com/obra/superpowers.git`, branch `main`, commit `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` (`Release v6.3.0: Devin CLI and Hermes Agent support, brainstorming three-path router, SDD/Codex efficiency fixes (#2125)`), committed 2026-08-12T09:53:21-07:00; cloned shallow and inspected 2026-08-20.
- Read all fourteen upstream workflow skills: `brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`, `dispatching-parallel-agents`, `systematic-debugging`, `test-driven-development`, `verification-before-completion`, `requesting-code-review`, `receiving-code-review`, `using-superpowers`, `using-git-worktrees`, `finishing-a-development-branch`, and `writing-skills`, including their role prompts, debugger/test references, Pi mapping, SDD scripts, hook/bootstrap implementation, porting guide, manifest, and Pi extension/tests.
- Read apple-pi's `docs/ledger.md`, `docs/boundaries.md`, `docs/exec.md`, `docs/subagents.md`, `docs/advisor.md`, `components/shared/src/ledger-system-prompt.ts`, all Ledger lifecycle skills, `pi-ralph`, and `pi-review`.
- Commissioned independent fresh-context architecture review of the two source sets. It recommended a principles-only adaptation and identified existing hard boundaries. Its conclusions were checked against the cited files.

## Findings

### Upstream methodology inventory and disposition

| Superpowers surface | Core contribution | Ledger disposition |
| --- | --- | --- |
| `using-superpowers` | Mandatory bootstrap and skill-before-action doctrine | Reject bootstrap. apple-pi skills are on-demand; a second injected global process authority would consume context and conflict with the existing Ledger contract. |
| `brainstorming` | Spike / bounded / architectural routing, clarification, explicit approval | Adapt the scaling principle into `ledger-shape-task`; retain Ledger's explicit authorization and do not add a separate design-document workflow. |
| `writing-plans` | Small testable tasks, source paths, spec coverage, plan self-review | Adapt testable-increment and coverage checks. Reject exact-code, minute-scale scripts and per-step commit instructions. |
| `executing-plans` | Preflight plan review, ordered execution, stop on unresolved gaps | Adapt as controller guidance in `ledger-execute-task`; Ledger already owns status and backpressure. |
| `subagent-driven-development` | Fresh implementers, independent task review, reports, capped re-review | Retain the portable fresh-context and scoped re-review ideas. Reject `.superpowers/sdd` workspace, second progress ledger, fixed five-round rule, controller rulings of unresolved meaning, and worker-owned commits. Ralph + `pi-review` are stronger native primitives. |
| `dispatching-parallel-agents` | Parallelize only independent work and integrate with a full check | Already represented by `pi_exec` `parallel`, typed lanes, and review fan-out. Add no new mechanism. |
| `systematic-debugging` | Reproduce, trace, compare, hypothesize, test one variable, escalate repeated failures | Adapt into `ledger-research-task` and Ralph worker guidance. |
| `test-driven-development` | Observe an intended failure before minimal behavioral implementation, then observe success | Adapt as criterion-specific fail-first evidence when feasible. Reject a universal test mandate for documentation, configuration, runtime/deployment, and process criteria. |
| `verification-before-completion` | Fresh claim-matched evidence and independent checking of delegated work | Already aligned with Ledger's evidence rule. Tighten stage skill wording to require procedure, current result, scope, and limits. |
| `requesting-code-review` / `receiving-code-review` | Independent review, severity disposition, verify feedback before changing code | Already superseded by `pi-review` planner/reviewer/verifier topology. Preserve targeted re-review after a confirmed fix. |
| `using-git-worktrees` / `finishing-a-development-branch` | Isolation and explicit integration choices | Reject as automatic workflow. apple-pi intentionally leaves worktree, commit, push, merge, and cleanup authority with the operator. |
| `writing-skills` | Baseline/treatment, pressure-scenario, and fresh-context skill evaluation | Adapt when changing behavior-shaping Ledger skills; deterministic unit tests alone do not prove prompt behavior. |
| Pi extension, tool map, and porting guide | Automatic bootstrap and mapping for a weaker Pi environment | Reject as a runtime dependency or reference implementation. apple-pi already provides native `Agent`, `pi_exec`, Ledger, Advisor, and profile/capability boundaries. |

### Existing apple-pi strengths

1. One task bundle contains scope, acceptance criteria, work items, assumptions, blockers, evidence, review, retrospective, and distillation. It is deliberately not a second project wiki (`docs/ledger.md`).
2. Ralph supplies bounded, sequential, fresh coding workers; the controller owns batch bounds and integration; review remains a separate, independently invoked primitive (`skills/pi-ralph/SKILL.md`).
3. `pi-review` is a stronger review spine than a single task reviewer: it can semantically partition, use read-only fresh workers, independently verify findings, surface coverage gaps, and choose risk-matched topology (`skills/pi-review/SKILL.md`).
4. `pi_exec` supplies bounded, structured fan-out, context shaping, typed output, tracing, and per-program limits; `Agent` separately supplies long-lived interactive collaboration (`docs/exec.md`, `docs/subagents.md`).
5. Advisor already provides continuous, read-only, severity-tagged peer correction. It must not become a task judge or replace independent review (`docs/advisor.md`).
6. The repository expressly rejects a Ledger catalog, active-task pointer, operations hub, hidden status store, and duplicate runtime (`docs/boundaries.md` and the Ledger system prompt).

### Recommended topology

Keep one coherent flow:

```text
shape → research / specify / plan as needed → explicit implementation authority
→ bounded Ralph batch → independent pi-review → targeted fix batch when evidence requires it
→ criterion evidence → distill / close
```

The smallest candidate changes, only after baseline evidence demonstrates a gap, are:

- `skills/ledger-shape-task/SKILL.md`: scale artifacts by spike, bounded task, or architectural/multi-iteration task; complexity may escalate but not silently downgrade.
- `skills/ledger-research-task/SKILL.md`: add reproduction, origin tracing, comparison path, one falsifiable hypothesis, smallest discriminating check, and an architectural blocker after repeated failed fixes.
- `skills/ledger-plan-task/SKILL.md`: require review-worthy increments and criterion-matched failure/backpressure checks where feasible; keep plans semantic and source-backed.
- `skills/ledger-execute-task/SKILL.md`: carry criterion-specific backpressure into Ralph and route confirmed review findings into the next bounded batch; distinguish confirmed, rejected, and unresolved results.
- `skills/pi-ralph/references/increment.md`: add compact root-cause, fail-first, and fresh-evidence clauses while preserving one increment, no commits, and no review.
- `skills/ledger-distill-close-task/SKILL.md` and `docs/ledger.md`: require current procedure, result, scope, and limits for closure evidence.

Do not add top-level skills, a global prompt injection, a Superpowers dependency, a `.superpowers` directory, a worktree manager, a task controller/judge, or a Ledger UI/runtime.

### Required behavior evaluation before wording changes

Superpowers' evidence was produced under its bootstrap, harnesses, and prompts; it does not establish that apple-pi currently fails any behavior. Before changing an apple-pi skill, run fresh-context baseline and treatment scenarios (at least five repetitions per variant) for: no-ceremony one-off work; bounded task artifact scaling; architectural ambiguity; reproduce-before-fix; criterion-matched fresh evidence; and confirmed versus false review candidates. Make no change where baseline behavior already meets the intended boundary.

## Conclusions

The methodologies compose cleanly only as a **Ledger-native adaptation of portable behavioral principles**, not as a direct Superpowers installation. Ledger should be the sole durable state and lifecycle authority; Ralph, `pi_exec`, typed subagents, `pi-review`, Advisor, and current execution boundaries should remain their present owners. The study supports a staged, evaluation-led update to existing lifecycle skills if the operator ratifies that boundary.

Literal copying from the MIT-licensed upstream source would require attribution under `THIRD_PARTY_NOTICES.md`; the proposed direction is independent behavior-level adaptation, not copied source or a dependency.

## Limits

- This study inspected source and documentation only. It did not run fresh-context behavior evaluations, mutate apple-pi production code or skills, run validation commands, or activate any new workflow.
- The upstream checkout is a shallow clone at the stated `main` commit; it does not establish historical rationale beyond the sources read.
- The proposed task boundaries require operator ratification before implementation because they change agent workflow semantics.

## Related Records

- `.ledger/202608202235-evaluate-superpowers-ledger-integration/task.md`
- `docs/ledger.md`
- `docs/boundaries.md`
- `skills/ledger-shape-task/SKILL.md`
- `skills/ledger-research-task/SKILL.md`
- `skills/ledger-plan-task/SKILL.md`
- `skills/ledger-execute-task/SKILL.md`
- `skills/pi-ralph/SKILL.md`
- `skills/pi-review/SKILL.md`

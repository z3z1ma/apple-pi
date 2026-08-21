Status: active
Created: 2026-08-20
Updated: 2026-08-20

# apple-pi Superpowers workflow fusion

## Purpose And Authority

Define the behavior of the user-ratified fusion of `obra/superpowers` main at `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` with apple-pi. This specification is governed by `decisions/fusion-scope.md`. It supersedes the preceding principles-only recommendation for the succeeding implementation work.

## Actors And Boundaries

- **Operator:** owns product intent, design approval, implementation authorization, integration choices, and any external or destructive action.
- **Root apple-pi session:** owns the active workflow, discovers and loads the applicable fused skill, maintains current intent, and chooses an apple-pi primitive without inventing unavailable capability.
- **Ledger:** is the only durable task and workflow state. It owns task authority, supporting records, evidence, review disposition, and distillation.
- **`Agent`:** provides typed, persistent, ownership-scoped collaboration sessions. It replaces generic Superpowers `Task` assumptions when long-lived specialist interaction, resume, steering, or explicit child ownership is required.
- **`pi_exec`:** provides bounded disposable composition, structured model workers, fan-out, reduction, explicit context, budgets, and traces. It owns parallel investigation/review graphs and programmatic fresh-worker orchestration.
- **Ralph:** remains the fresh-context implementation-loop owner; the fused workflow may add a clearly bounded advanced composition only when it preserves caller batch control and independent review semantics.
- **`pi-review`:** owns candidate/finding epistemics and independent review composition. It does not become an implementation controller.
- **Advisor:** remains a read-only peer. It may challenge a workflow decision but does not mutate Ledger or judge completion.

## Required Behavior

### Complete methodology inventory

The delivered workflow MUST provide a discoverable apple-pi equivalent for each upstream Superpowers skill: `using-superpowers`, `brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`, `dispatching-parallel-agents`, `systematic-debugging`, `test-driven-development`, `verification-before-completion`, `requesting-code-review`, `receiving-code-review`, `using-git-worktrees`, `finishing-a-development-branch`, and `writing-skills`.

Each supporting role prompt, script, check, and state artifact that materially causes an upstream workflow behavior MUST be traceable either to retained/adapted apple-pi text, an existing apple-pi primitive, or an explicit incompatible-boundary rationale. The implementation MUST NOT treat pre-existing apple-pi documentation as a substitute without this traceability.

### Happy path

For a new software outcome, the workflow MUST lead an agent through the following stages in order unless the scoped request makes a stage inapplicable:

1. discover the applicable workflow and classify the request's scope;
2. clarify intent, constraints, and success criteria; for material design work, explore alternatives and obtain the operator's approval before implementation;
3. establish Ledger task authority and scale task-local artifacts to the work;
4. research unresolved facts, specify behavior/decisions, and create a source-backed plan before multi-step implementation;
5. execute in bounded increments using the appropriate apple-pi primitive and explicit fresh-context handoff;
6. apply test-first behavior work where a failing behavioral check is feasible, investigate root cause before a fix, and run criterion-matched backpressure;
7. obtain and receive independent review through `pi-review`, verify findings before changing code, and scope fix re-review to confirmed findings;
8. verify each completion claim with fresh evidence; distill durable lessons and present operator-owned integration choices.

The workflow MUST preserve Superpowers' stop/clarify/escalate behavior for unknown requirements, inconclusive diagnosis, failed verification, and conflicting review feedback. It MUST NOT manufacture completion, silently guess, or let a worker report substitute for evidence.

### apple-pi action translation

A fused skill MUST name real apple-pi actions and must not imply a generic `Task`, `TodoWrite`, or unbounded shell controller exists.

- Use the native skill mechanism appropriate to the session; if a model must load a skill, direct it to the actual apple-pi discovery/read path.
- Use `Agent` for typed interactive collaboration and ownership-scoped durable sessions; use `pi_exec` for bounded programmatic worker graphs and parallelism; use neither merely because the upstream uses a generic subagent.
- Use the existing Ledger task root and supporting records instead of an independent plan/progress/report workspace. A translated artifact MUST retain the upstream artifact's consumer, lifecycle, and failure consequence.
- Translate worktree and finishing instructions to the apple-pi authority model: worktree setup, commit, push, merge, PR, and cleanup happen only with required operator authority and never destroy or overwrite unowned work. The stages remain explicit rather than absent.

### Text and attribution fidelity

The fusion SHOULD retain upstream language wherever its behavior and authority remain valid. Changes to wording MUST be limited to apple-pi terminology, actual tool/action mapping, Ledger ownership, higher-priority safety constraints, or clarity required by the new composed workflow. The traceability matrix MUST identify the source passage and disposition for every material deletion, relocation, or alteration.

Any literal upstream text in the package MUST carry the upstream MIT attribution in `THIRD_PARTY_NOTICES.md`.

### Evaluation

Behavior-shaping skill changes MUST have fresh-context baseline and treatment evidence. Evaluations MUST use a disposable root Pi session with normal root prompt and tools in an isolated sandbox; a typed specialist lane is not a valid proxy for root-session behavior. Evaluation output must preserve prompt, context conditions, observed actions/result, classification, and limits.

## Error And Failure Behavior

- No automatic bootstrap or skill discovery mechanism may silently fail; failure to load required workflow guidance must remain observable and prevent claims that the fusion is active.
- A missing primitive or unavailable agent type must cause an explicit apple-pi fallback or block, never an invented tool call.
- If a proposed translated artifact creates duplicate state or has no production/workflow consumer, reject it and retain the Ledger owner.
- A current workflow failure, failed treatment evaluation, or unresolved significant review finding blocks the affected task; it cannot be parked as successful completion merely due to a retry cap.
- Any incompatibility between upstream source and apple-pi safety/authority constraints must be logged in the traceability matrix and surfaced for operator decision when it changes behavior materially.

## Given-When-Then Scenarios

- **Given** a normal root session begins a non-trivial request, **when** the request has a matching fused workflow, **then** the workflow is discoverable and directs the agent to scope/design/approval rather than immediately writing code.
- **Given** an approved multi-step outcome, **when** the agent reaches execution, **then** it creates or follows one Ledger task and uses bounded Ralph, `Agent`, or `pi_exec` work according to their real ownership rather than a duplicate Superpowers workspace.
- **Given** two genuinely independent investigations, **when** parallelism is useful, **then** the controller uses bounded `pi_exec` fan-out with self-contained context and combined verification; dependent writers remain sequential.
- **Given** a regression with an unknown cause, **when** an agent begins repair, **then** it captures reproduction and a falsifiable hypothesis before production mutation or explains why that evidence is unavailable.
- **Given** a behavior change with a feasible failing check, **when** implementation starts, **then** the record contains observed failure evidence before the minimal correction and observed passing evidence afterward.
- **Given** a review candidate, **when** its trigger/evidence/impact is incomplete, **then** `pi-review` verifies, rejects, or leaves it explicitly unresolved rather than treating it as a confirmed defect.
- **Given** a completed implementation, **when** integration remains, **then** it presents fresh evidence and preserves operator authority for commit, branch, merge, push, PR, cleanup, and discard choices.

## Acceptance Mapping

- AC-001: Complete inventory and traceability matrix.
- AC-002: Single Ledger state, authentic apple-pi primitive mapping, and absent duplicate runtime/state.
- AC-003: Happy-path, debugging, TDD, review, verification, and finishing semantics.
- AC-004: Root-session baseline/treatment behavior evidence.
- AC-005: Focused validation, independent review, residual-risk record, and distillation.

## Exclusions

- A verbatim second copy of Superpowers or a compatibility wrapper beside a different apple-pi workflow.
- Generic agent/task APIs that do not exist in apple-pi.
- Unbounded, self-authorizing agents; silent tool fallbacks; unowned external effects; and disposal of uncommitted work.

## Assumptions And Provenance

- The operator explicitly requested near-wholesale retention and enhancement of the upstream methodology, adapted to Ledger, `Agent`, and `pi_exec`.
- Upstream source behavior and language are evidence, not overriding authority; the operator's instruction and higher-priority safety constraints govern conflicts.
- Exact source mapping and implementation decomposition remain planning work; this specification authorizes no production edit by itself.

## Related Records

- `.ledger/202608202254-strengthen-ledger-workflow/decisions/fusion-scope.md`
- `.ledger/202608202235-evaluate-superpowers-ledger-integration/research/superpowers-main-methodology.md`
- `docs/ledger.md`
- `docs/subagents.md`
- `docs/exec.md`

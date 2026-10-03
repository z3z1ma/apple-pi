# Public-subagent resume policy

This is the approved pre-implementation design snapshot. The undertaking is now closed; [task.md](task.md) records its implementation, validation evidence, and operator closeout decision. The sections below retain the decisions and evidence as recorded at specification approval.

## Problem Statement

Resuming a public subagent can require restating settings that were fixed when its session started. In particular, the current root and nested callers interpret omitted `inherit_context` and `isolated` as `false`, so omission can reject a continuation whose stored choice is `true`. Other fixed settings already reuse stored choices when omitted.

The main agent's root `agent` tool and a public subagent's ownership-scoped nested `agent` tool also repeat the same five compatibility comparisons. A maintainer must understand and change both implementations to keep public-subagent resume behavior consistent.

## Solution

Make omission consistently mean “reuse this session's stored choice” for every fixed resume setting. Explicitly supplied choices must still match the stored choices; a resume cannot change the session's configuration.

Deepen the existing invocation-policy module so one interface owns the compatibility decision. Root and nested public-subagent callers consume that decision while retaining their own ownership checks, result presentation, and execution.

## User Stories

1. As a main agent, I want to resume a public subagent without restating its fixed settings, so that I can continue its work using the session's existing choices.
2. As a delegating public subagent, I want the same omission rules for an owned nested teammate, so that continuation behaves consistently with root delegation.
3. As a main agent, I want omitted `inherit_context` to preserve the stored choice, so that a session started with inherited context can resume without restating `true`.
4. As a delegating public subagent, I want omitted `isolated` to preserve the stored choice, so that an isolated teammate can resume without restating `true`.
5. As a main agent, I want omitted `pair` to preserve the stored choice, so that resuming a teammate does not change whether it has a pair programmer.
6. As a delegating public subagent, I want omitted `profile` to preserve the stored choice, so that resuming a teammate does not reselect its model profile.
7. As a main agent, I want omitted `system_prompt` to preserve the stored guidance, so that continuation does not require repeating the original invocation instructions.
8. As a main agent, I want an explicit matching `inherit_context` choice to be accepted, so that a self-contained resume request remains valid.
9. As a delegating public subagent, I want an explicit matching `isolated` choice to be accepted, so that I can restate a teammate's configuration without changing it.
10. As a main agent, I want an explicit matching `pair` choice to be accepted, so that both omitted and fully stated continuation requests work.
11. As a delegating public subagent, I want an explicit matching `profile` choice to be accepted, so that I can restate the selected profile without reconfiguring the session.
12. As a main agent, I want an explicit matching `system_prompt` to be accepted after the existing whitespace normalization, so that restating the guidance keeps its current behavior.
13. As a main agent, I want a changed `inherit_context` choice to be rejected, so that a resume cannot change the session's original context-inheritance choice.
14. As a delegating public subagent, I want a changed `isolated` choice to be rejected, so that a resume cannot change the session's original isolation choice.
15. As a main agent, I want a changed `pair` choice to be rejected, so that a resume cannot add or remove the pair programmer.
16. As a delegating public subagent, I want a changed `profile` choice to be rejected, so that a resume cannot switch the session's inference policy.
17. As a main agent, I want changed nonblank `system_prompt` guidance to be rejected, so that a resume cannot replace the invocation instructions fixed at session start.
18. As a main agent, I want explicit `false` to remain distinct from omission, so that a conflicting choice is rejected rather than silently ignored.
19. As a delegating public subagent, I want blank or whitespace-only `system_prompt` to retain its existing treatment as omission, so that this refactor preserves the established prompt-normalization behavior.
20. As a main agent, I want to choose foreground or background execution independently on each resume, so that I can change how I wait for work without changing the teammate's fixed settings.
21. As a delegating public subagent, I want resume ownership checks to remain enforced, so that shared policy does not grant access to another participant's teammate.
22. As a maintainer, I want one module to own the five-setting compatibility policy, so that a policy change has locality rather than two separately maintained implementations.
23. As a maintainer, I want tests through the invocation-policy interface, so that verification survives changes to the module's internal implementation.
24. As a maintainer, I want root and nested tool tests to exercise the shared policy, so that a correct policy module cannot hide an unconverted caller.
25. As a maintainer, I want new-session defaults to remain unchanged, so that the resume correction does not alter initial teammate launches.
26. As a maintainer, I want tool guidance and product documentation to distinguish omitted resume settings from explicit changes, so that callers can use the corrected behavior without learning implementation details.

## Implementation Decisions

- Deepen the existing invocation-policy module rather than introducing a parallel resume-policy module or another orchestration model. Its interface owns the compatibility decision, including omission rules, normalization, and the five immutable-setting comparisons.
- The policy is in-process computation. Its seam requires no new adapter, configurable policy, or external dependency.
- The five fixed settings are `inherit_context`, `isolated`, `pair`, `profile`, and `system_prompt`. On resume, omission reuses the stored choice for each setting; it never reapplies new-session defaults or consults changed agent-definition defaults.
- Explicit boolean choices retain their value. In particular, explicit `false` is not omission. A value that differs from the stored choice is rejected; a matching value is accepted.
- Preserve the current prompt normalization: trim a supplied `system_prompt`; treat blank or whitespace-only input as omission. A nonblank prompt must match the stored normalized guidance.
- Rejected compatibility returns the existing fixed-settings error through the caller's existing error-result path and does not invoke resume or mutate the stored invocation.
- Both root and nested public-subagent callers use the shared compatibility decision. They retain their ownership checks, catalog and model-profile resolution responsibilities, execution, and result presentation. Shared policy grants no capabilities.
- Keep the agent runner and manager state machines cohesive and unchanged in responsibility. Resume continues the existing session rather than creating a new one or rebuilding its fixed configuration.
- Foreground/background execution remains a per-invocation choice. It is not one of the fixed resume settings and remains outside the compatibility comparison.
- Preserve new-session normalization and defaults, including default `false` for context inheritance and isolation and the established pair-programmer selection rules.
- Preserve existing schemas and Pi validation behavior that distinguish an omitted setting from explicit `false`. This work does not require additional schema fields or a default-materialization mechanism.
- Update the public tool guidance and engineering-team documentation to describe omission consistently for root and nested resume callers. Runtime prompt-bearing guidance owns model-visible use; product documentation owns the complete user-facing contract.

## Testing Decisions

- **Confirmed primary seam:** the existing invocation-policy module's in-process interface. Exercise compatibility decisions using stored choices and requested settings; assert acceptance or rejection rather than helper calls, intermediate mappings, or private state.
- **Confirmed integration seam:** public `agent` tool execution in both root and nested contexts. Assert the observable result and whether the owned session resumes; retain coverage of caller-owned ownership restrictions. Both seams were confirmed by the operator before this specification was written.
- Cover omission, explicit equality, and explicit conflict for each of the five fixed settings. Include all fixed settings omitted together and stored `true` values for both `inherit_context` and `isolated`.
- Cover explicit `false` against stored `true` for each boolean setting, as well as matching stored `false`. A conflicting request must not resume the session or change its stored settings.
- Cover absent and selected stored optional choices for profile and guidance, unchanged nonblank normalized guidance, changed nonblank guidance, and blank/whitespace-only guidance retaining the stored choice.
- Verify foreground/background selection can vary on resume without relaxing the fixed-setting checks.
- Retain new-session default and invocation-override behavior through the existing invocation-policy interface. Consolidate redundant policy assertions where the shared interface becomes the test surface; preserve integration checks that prove both callers use it.
- Exercise the Pi argument-validation path as part of tool integration coverage, so omitted optional booleans with schema `default: false` remain distinguishable from explicitly supplied `false` before tool execution. Direct calls to `execute` alone cannot prove that distinction.
- Prior art: [subagent tests](../../../components/subagents/tests/subagents.test.ts) cover invocation defaults and nested tool execution; [runner integration tests](../../../components/subagents/tests/subagent-runner-e2e.test.ts) cover an incompatible root resume and successful continuation of the same session. Reuse those existing fixtures and test stand-ins rather than inventing a new dependency-injection framework.
- A focused factual check passed against the checkout's Pi 0.99 dependencies: the actual tool preparation and execution functions preserved `{}` as no supplied choices and preserved explicit boolean `false` as supplied choices. This established feasibility; it did not validate the proposed policy or either changed caller, since implementation has not started.
- A later TDD invocation requires its own fresh seam confirmation before test changes. This specification neither authorizes nor substitutes for that checkpoint.

## Out of Scope

- Notebook maintenance, compaction, reflection, session recall, work-panel behavior, and the other folders covered by the architecture survey.
- Changing any fixed choice on an existing session, resolving a new model profile on resume, or changing new-session defaults.
- Moving ownership checks, agent discovery, model routing, result formatting, or execution into invocation policy.
- Splitting the agent runner or manager by file length, merging participant lifecycles, or introducing a generic orchestration abstraction.
- Changing Pi Exec model-worker behavior or private BTW, consultation, and clarification behavior.
- New configuration fields, alternate policy implementations, compatibility migrations, persistence formats, or external adapters.
- Implementation, test-file edits, ticket generation, commits, publication, deployment, or remote tracker changes as part of this specification-writing step.

## Further Notes

### Governing sources

- [Engineering team contract](../../../docs/subagents.md): public-subagent continuation, fixed session settings, foreground/background execution, and ownership-scoped nested delegation. This specification changes omission semantics while preserving the invariant that fixed settings cannot change on resume.
- [Development conventions](../../../docs/development.md): cohesive runner/manager state machines and modules split at real consumers or test seams.
- [Adopted and rejected architecture](../../../docs/boundaries.md): one current implementation, no second subagent runtime, and explicit ownership/depth constraints.
- [Repository operating guide](../../../AGENTS.md): minimum code with maximum function, clarity, and leverage; prompt-bearing guidance and package validation responsibilities.
- [Working domain language](../../../.wiki/pages/domain-language.md): supporting vocabulary for public subagents, interactive child sessions, model profiles, and the main agent. Product docs and executable contracts remain authoritative.

### Settled direction and readiness

The operator selected the invocation-policy candidate, chose stored-choice reuse for all omitted fixed settings, invoked specification writing, approved this ledger destination, and confirmed both test seams. Blank prompt normalization, fixed-setting rejection, and per-invocation foreground/background selection retain their existing behavior.

The architecture survey produced a temporary HTML report and no repository changes. It found a bounded opportunity in repeated root/nested resume policy, not a reason to redesign the broader subagent lifecycle. No ADR, wiki mutation, research, or prototype is needed for this undertaking.

Acceptance is established when all five omitted settings reuse stored choices in root and nested public resumes, matching explicit settings succeed, conflicting explicit settings fail before resume, new-session behavior remains unchanged, both callers cross the shared policy interface, and relevant documentation and automated checks agree with those results. At specification approval, implementation and validation were pending.

The proposed hand-off at approval was `/skill:to-tickets`. Tickets were later skipped because the change fit one context, and implementation was completed. This archived specification creates no remaining build hand-off.

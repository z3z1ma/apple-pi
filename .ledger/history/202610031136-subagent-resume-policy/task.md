Status: done
Created: 2026-10-03
Updated: 2026-10-03

# Centralize public-subagent resume policy

## Intent

Resuming a public subagent previously treated omitted `inherit_context` and `isolated` as `false`, rejecting sessions whose stored choices were `true`. The five settings fixed at session start are `inherit_context`, `isolated`, `pair`, `profile`, and `system_prompt`.

Deepen the existing invocation-policy module so the main session's root `agent` tool and a public child's ownership-scoped nested `agent` tool share one resume-compatibility decision. All omitted fixed settings reuse the stored choices; explicitly changed settings remain rejected. Preserve caller-owned ownership checks, execution, new-session defaults, and the cohesive runner/manager state machines.

The settled behavior and confirmed test seams are in [spec.md](spec.md).

## Acceptance criteria

- Root and nested public resumes accept omitted fixed settings, including stored `true` for context inheritance and isolation.
- Explicit matching settings succeed; conflicting settings fail before resume and leave stored choices unchanged.
- Blank guidance retains its current treatment as omission; foreground/background selection remains changeable per invocation.
- Both callers use the shared policy interface; new-session defaults and ownership checks remain unchanged.
- Policy-interface and public-tool integration tests cover these outcomes, including Pi's omission-versus-explicit-false validation path.
- Runtime guidance and product documentation describe the corrected semantics; relevant automated checks pass.

## Current State

Implemented and committed as `69ef926` (`fix(subagents): preserve stored settings on resume`). The selected behavior and its scoped acceptance criteria are satisfied. The operator confirmed that the work is done and explicitly requested task closure. Root and nested callers share the existing invocation-policy module; omitted fixed settings reuse stored choices, while explicit changes remain rejected before continuation.

Both test seams were freshly confirmed before test edits. Root and nested omission regressions each failed with the intended original policy error, then passed after shared-policy integration. Tests exercise the actual Pi argument validator, matching and conflicting choices, prompt normalization, ownership, and foreground/background continuation. New-session defaults remain unchanged.

Implementation validation passed: repository formatting, lint, typecheck, 106 Vitest files / 1,186 tests, 118 offline pair-harness checks, extension-loader smoke test, package dry-run, and diff whitespace checks. Scoped pre-commit checks also passed, including 13 subagent files / 191 tests. Independent Standards and Intent/Spec reviews of the six-file diff against `8dc824f` found no material findings. The reflected documentation cleanup was inspected in the actual commit.

During implementation, repository-wide checks briefly failed in concurrently edited Pi Exec code; the implementation-phase rerun passed after that work settled. Subsequent commits have not changed the six implementation paths. No implementation defects, research, prototypes, or tickets remain.

The first closeout rerun at `8555e2c` passed formatting, lint, typecheck, and package dry-run. Vitest passed 106 suites / 1,186 test cases but failed an additional suite because a concurrently removed temporary Pi Exec test disappeared between discovery and loading.

After concurrent code edits settled, the latest full closeout run at `41b1443` again passed formatting, lint, typecheck, and package dry-run. Its unit stage failed 4 tests in 3 suites, with 1,182 passing: two standalone-extension registration tests reached their 5-second deadlines, and two task bash-tool tests failed detach/abort expectations. These are different failures from the earlier removed-file race. All four cases then passed in a focused current-tree rerun; they were not reproduced in isolation, but that full closeout test run still failed. Neither closeout attempt reached the pair or loader stages because those follow the unit stage through `&&`.

The selected six implementation paths remain unchanged. No source changes were made to address the out-of-scope test failures. Those results remain recorded without a claim that the latest full closeout suite passed. Live-provider/network E2E and installation from a packed tarball were not exercised; neither is an outstanding acceptance requirement for this bounded change.

### Closeout decision

The operator confirmed the scoped undertaking is complete and directed closure. The implementation-time validation and later closeout attempts are retained above as separate evidence. The later repository-wide failures do not create another implementation or validation hand-off owned by this completed task. Archived as `done`. The operator separately authorized committing the ledger closeout.

## Outcome

Completed the settled [specification](spec.md) in one context without creating horizontal tickets or a separate prefactor. Product documentation and model-visible guidance describe the corrected resume semantics. Implementation is committed; this workflow did not push. Closed on explicit operator confirmation. The archived ledger closeout was committed as `26b42ee` (`docs(ledger): close subagent resume policy task`) on the operator's request. No push was requested. No build or hand-off steps remain for this task.

Status: active
Created: 2026-08-16
Updated: 2026-08-16

# Implementation plan

## Outcome

Make review usable with controller-supplied typed result tools, tolerant truly optional collections, harness-owned execution policy, and explicit terminal causes. Then apply the established public-policy/cause boundary to Ralph, Agent/nested Agent, and Pi Exec without weakening their internal safety controls.

## Current-System Evidence

- The normal live run `939c6d47-6177-4c52-9672-f8931f6cd4de` reached the Luna planner successfully but failed because `parsePlannerOutput()` required omitted optional `contextPaths`.
- Review currently advertises eight raw numeric controls despite `normalizeBudgets()` already supplying defaults.
- Review uses fresh planner, reviewer-group, and finding-bearing verifier-group roles. Parser failures currently consume a role call and fail coverage without a correction turn.
- Pi's managed-agent API supports fresh runs, turn and token ceilings, signals, policy, usage, compaction, and activity callbacks, but no native structured response-schema API.
- Ralph forwards remaining raw token/time/turn arithmetic to ReviewController. Agent/nested Agent expose `max_turns`; Pi Exec exposes call, worker, memory, concurrency, and timeout arithmetic.

## Change Surfaces

1. `components/subagents/src/service.ts`, `agent-manager.ts`, `agent-runner.ts`, and focused service tests.
   - Thread controller-supplied SDK custom tools through `ManagedAgentRequest`, spawn/run options, and `createAgentSession({ customTools })`; admit their names in the static allowlist used when `extensions: false`.
2. `components/review/src/roles.ts`, `types.ts`, `controller.ts`, `receipts.ts`, `index.ts`, role skills, tests, docs.
   - Give each role a terminating TypeBox result tool and capture only validated tool arguments; fail on missing/multiple/inconsistent submission and remove prose JSON parsing/fallback.
   - Normalize truly optional collections only inside valid tool arguments; semantic graph/coverage/path/anchor failures remain fail-closed.
   - Replace public budget input with staged deterministic policy derivation and typed terminal cause. Use sealed change shape only for group/concurrency caps; after resolving each role route, render and measure its complete prompt and result-tool signature (background, authority packet, context paths, findings), reserve resolved-model output capacity, then derive that role envelope and persist additive receipt data.
2. `components/ralph/src/controller.ts`, `index.ts`, types/receipts/tests/docs.
   - Remove normal raw budget input and stop forwarding caller arithmetic to shared review; map Ralph semantic mode/work size to internal policy and retain separate cause/accounting.
3. `components/subagents/src/index.ts`, `nested-tools.ts`, invocation/config/runner/status tests/docs.
   - Remove per-call model turn arithmetic from public Agent surfaces; preserve agent-definition and trusted settings policy plus internal hard limits and truthful status causes.
4. `extensions/runtime.ts`, runtime tests, README.
   - Remove raw Pi Exec resource arithmetic from normal model schema; select internal envelope by program shape and retain package maxima, cancellation, traces, and explicit outcomes.

## Sequence

1. Add managed-service tests proving controller custom tools reach extensionless sessions, plus review tests for exact typed planner/reviewer/verifier submissions, optional collections, missing/multiple result calls, and semantic invariant failure.
2. Implement typed review result tools and remove prose parsing/fallback. Verify deterministic tests and repeat the normal-environment disposable-repository smoke. Stop if review does not reach reviewer/verifier; record the next observed failure instead of guessing.
3. Introduce stage-aware review policy derivation, remove model/normal-command arithmetic, persist measured per-role prompt/model-capacity envelopes and cause additively, and validate profile scaling, broad background/authority context, context-window preflight failure, and old receipt loading.
4. Migrate Ralph's public and nested review policy boundary, then validate state-machine and receipt behavior.
5. Migrate Agent/nested Agent and Pi Exec public surfaces, preserving trusted settings and hard controller/package maxima.
6. Update documentation and run typecheck, focused suites, full test, loader validation, pack check, and a final normal-environment review smoke.

## Acceptance And Backpressure

- AC-001: tool-schema and command-completion tests prove raw review/Ralph/Agent/Pi Exec arithmetic is absent from ordinary model/command paths.
- AC-002/AC-006: policy unit tests prove deterministic group/concurrency caps for small, medium, and ceiling-exceeding sealed inputs; measured planner/reviewer/verifier envelopes include complete rendered prompts and model capacity; live review of the two-file smoke reaches at least the reviewer after omitted optional planner collections.
- AC-003/AC-004: subagent and Pi Exec tests prove default/internal policy still bounds live execution without public numeric input.
- AC-005: controller/receipt tests distinguish operator stop, external cancellation, elapsed, aggregate token, turn, compaction, provider, invalid-output, authority, and workspace/input causes.
- AC-007: old review schema-v1 and Ralph schema-v2 receipts load without inferred new policy; new fields validate additively.
- AC-008/AC-009: command, docs, loader, and full-suite checks reconcile the new intent contract.

Per increment:

```text
npm run typecheck
npm run test:unit -- tests/review-core.test.ts tests/review-controller.test.ts
```

Final gate:

```text
npm run typecheck
npm test
npm run pack:check
```

## Risks And Failure Modes

- Tool submission can be omitted or duplicated. The terminating typed tool captures schema-validated arguments; missing, multiple, or inconsistent submission fails closed with no prose fallback or retry.
- Optional defaulting must not make required coverage or unsafe path errors succeed.
- Public removal must not remove internal ceilings, cancellation, accounting, or audit fields.
- Existing persisted receipts must not be resumed under invented policy semantics.
- Live smoke uses the normal environment and creates normal operational receipts/child sessions; no test may override `PI_CODING_AGENT_DIR`.

## Integration Points

- ManagedSubagentService `runFresh` and its internal hard turn/token/signal controls.
- Review sealed input, work graph, receipt chain, lease, and independent verifier boundary.
- Ralph shared-review call boundary.
- Subagent default settings/agent frontmatter and Pi Exec worker envelope.

## Rollback Or Recovery

- Typed result submission and optional-collection normalization are independent of public policy removal and land first.
- New policy/cause receipt fields are additive; old receipts remain readable.
- A failed live review leaves a receipt and no target mutation; inspect it before any retry.
- Do not restore public numeric fields as a quick workaround for an invalid output or provider failure.

## Related Records

- `.ledger/202608151813-replace-caller-budget-arithmetic/research/current-state.md`
- `.ledger/202608151813-replace-caller-budget-arithmetic/research/live-review-smoke.md`
- `.ledger/202608151813-replace-caller-budget-arithmetic/decisions/ownership.md`
- `.ledger/202608151813-replace-caller-budget-arithmetic/specs/review-policy.md`

Status: partial
Created: 2026-08-15
Updated: 2026-08-16

# Replace caller-configured budget arithmetic with harness-owned limits

## Scope

Redesign review, Ralph, subagent, and Pi Exec execution limits so ordinary model calls express task intent rather than numeric resource guesses. Controllers must derive practical allowances from known workload and trusted policy while retaining explicit hard safety ceilings, usage accounting, cancellation, bounded concurrency, and honest terminal outcomes. Trusted human or configuration surfaces may retain expert overrides where they have a clear operational use.

## Non-goals

- Removing cancellation, safety ceilings, resource accounting, or receipt usage data.
- Allowing unlimited parallel model or host execution.
- Treating an exhausted limit as successful completion.
- Changing model routing except where a semantic effort/profile contract intentionally owns both routing and internal limits.
- Reorganizing unrelated modules; the later architecture-convergence task owns structural cleanup after this API settles.

## Acceptance Criteria

- AC-001: Normal model-facing review, Ralph, Agent, nested-Agent, and Pi Exec schemas no longer ask the model to choose raw token, turn, timeout, group-count, concurrency, memory, call-count, or worker-count budgets.
- AC-002: Review and Ralph accept semantic intent only where it changes expected behavior, derive internal allowances deterministically from sealed workload characteristics and trusted policy, and record the resolved policy in run state and receipts.
- AC-003: Public Agent runs default to agent definition or trusted settings and otherwise remain unlimited by turns; internal managed roles retain controller-owned hard turn, token, timeout, compaction, and tool-policy gates.
- AC-004: Pi Exec retains bounded calls, concurrency, agents, memory, and elapsed time without requiring normal model calls to estimate those values; any expert override is human/config-owned and cannot silently bypass package maxima.
- AC-005: Operator stop, external interruption, timeout, token ceiling, turn ceiling, compaction, provider error, authority denial, and workspace conflict remain distinct causes through agent records, controller gates, receipts, tool results, and UI copy.
- AC-006: Every planner, reviewer, and verifier submits a controller-supplied typed result tool call rather than prose JSON. The observed two-file smoke reaches reviewer execution after tolerant normalization of truly optional empty collections; malformed tool arguments, missing result submission, and semantic invariant failures remain fail-closed. Scaling tests demonstrate larger sealed inputs receiving sufficient internal allowance while package hard maxima still stop runaway work.
- AC-007: Existing persisted review and Ralph receipts remain loadable or receive an explicit audit-only migration boundary; no run is resumed under ambiguous budget semantics.
- AC-008: Slash commands and trusted settings document any retained expert controls separately from the model-facing tool contract, including defaults, maxima, and consequences.
- AC-009: README, review, Ralph, subagent, Pi Exec, package-loader, schema, controller, and terminal-outcome tests are reconciled with the new ownership model.

## References

- `.ledger/202608151813-replace-caller-budget-arithmetic/research/current-state.md`
- `.ledger/202608151813-replace-caller-budget-arithmetic/research/live-review-smoke.md`
- `.ledger/202608151813-replace-caller-budget-arithmetic/decisions/ownership.md`
- `.ledger/202608151813-replace-caller-budget-arithmetic/specs/review-policy.md`
- `.ledger/202608151813-replace-caller-budget-arithmetic/plans/implementation.md`
- `components/review/src/index.ts`
- `components/review/src/controller.ts`
- `components/ralph/src/index.ts`
- `components/ralph/src/controller.ts`
- `components/subagents/src/index.ts`
- `components/subagents/src/service.ts`
- `components/subagents/src/agent-runner.ts`
- `extensions/runtime.ts`
- `docs/review.md`
- `docs/ralph.md`

## Assumptions

- User-ratified: numeric budget selection by the model is a bad product experience and current defaults have caused premature failures in use.
- Record-backed: omitted values already select defaults, so removing fields from model schemas does not remove the underlying safety machinery.
- Record-backed: hard ceilings, accounting, and honest incomplete outcomes are safety invariants and must remain controller-owned.
- Record-backed: humans and trusted configuration are the appropriate authority for rare numeric overrides.

## Journal

- 2026-08-15: Opened after tracing model schemas, command options, defaults, nested budget propagation, managed-agent enforcement, and abort classification across review, Ralph, subagents, and Pi Exec.
- 2026-08-15: Chose intent-based model contracts with retained internal hard limits; exact scaling and compatibility policy remain to be specified.
- 2026-08-16: Normal-environment live review reached the planner but failed on an omitted optional `contextPaths` collection after 1,911 tokens; active policy, decision, research, and plan now require controller-supplied typed result tools rather than prose JSON parsing.
- 2026-08-16: Implemented and live-validated typed review role submissions. Follow-up normal-environment run `5fb7f785-82db-4804-a2f0-6bf82bdaff2c` completed 2/2 coverage with a confirmed minor finding after planner, reviewer, and verifier all used extensionless managed sessions with controller-supplied terminating tools.
- 2026-08-16: Removed raw numeric resource arithmetic from normal review, Ralph, Agent/nested-Agent, and Pi Exec tool/command schemas. Review now derives a sealed-input profile policy, measures full stage prompt/tool contracts against resolved model capacity, reserves aggregate admission capacity, and persists additive policy/envelope/cause fields. Ralph derives internal policy from mode and compiled graph shape; Pi Exec derives its envelope from program shape.
- 2026-08-16: Live normal-environment fast review runs `8b94d4a4-532f-419c-bfef-8db27d71bcdb` and `9670d5bc-f25c-4efe-bdc4-5262f829574f` each completed 2/2 coverage in disposable repositories using the new policy path. The final run followed complete managed system-prompt and read-only-tool envelope accounting; receipts recorded per-stage policy envelopes and both repositories were removed after their runs.
- 2026-08-16: Corrected concurrent review admission accounting: each role now consumes its own reservation as live usage arrives and releases only its unused remainder. Role hard caps use settled plus live usage; admission uses only unconsumed reservations, avoiding double-counting.

## Blockers

None.

## Evidence

- Done: `npm run typecheck`.
- Done: `npm run test:unit -- tests/review-core.test.ts tests/review-controller.test.ts tests/subagents.test.ts tests/subagent-runner-e2e.test.ts` (4 files, 32 tests), including absent/duplicate typed submission failure and real extensionless custom-tool admission.
- Done: Normal-environment disposable-repository review run `5fb7f785-82db-4804-a2f0-6bf82bdaff2c` completed 2/2 coverage; receipt and managed child sessions remain in the normal agent directory.
- Done: Normal-environment disposable-repository review run `9670d5bc-f25c-4efe-bdc4-5262f829574f` completed 2/2 coverage under the final harness-owned policy path; its receipt includes resolved planner/reviewer/verifier envelopes.
- Done: `npm run typecheck`.
- Done: focused unit suites (9 files, 86 tests), including typed causes, policy capacity, receipt compatibility, public-schema removal, Pi Exec bounds, and Ralph policy derivation.
- Done: `npm run typecheck`, focused policy/controller/runtime/Ralph suites, `npm run test:loader`, `npm run pack:check`, and `git diff --check`; package dry-run left no tarball artifact.
- Partial: a final whole-suite `npm test` run timed out only in pre-existing `tests/ralph-state-machine.test.ts` under its 5-second per-test limit. Running that file alone immediately passed all 14 tests in 31.89 seconds; the full suite passed before the final review-policy-only reservation correction. The final whole-suite proof is therefore not available from this run.

## Review

Same-context review validated the terminal-cause and policy-reservation invariants through focused tests. No independent review was requested for this manual reliability/policy increment.

## Retrospective

Structured role output belongs at a typed controller tool boundary, not in prose parsing or repair prompts. Per-request context capacity and cumulative role allowance are different dimensions: preflight the full prompt/tool contract per request, then reserve a multi-request aggregate allowance atomically before concurrent launch.

## Distillation

No promotion needed: the durable policy and typed-result procedure are implemented in packaged runtime code, role skills, and repository documentation; no separate reusable artifact has an independent consumer.

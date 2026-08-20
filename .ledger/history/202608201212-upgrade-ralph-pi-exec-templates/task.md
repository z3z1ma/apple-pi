Status: done
Created: 2026-08-20
Updated: 2026-08-20

# Bring Ralph templates to pi_exec standard-library quality

## Scope

Bring the packaged Ralph skill to the same deliberate pi_exec-template quality as the in-progress review skill enhancement. Keep the default fresh-increment loop separate from review, add one adaptable increment-prompt reference, modernize the opt-in reviewed composition with the existing standard-library primitives that add semantics, strengthen both skill bodies, and test the packaged template contracts.

## Non-goals

- Add runtime standard-library APIs or modify pi_exec implementation, documentation, or public API.
- Add more Ralph wrappers beyond the default loop and one opt-in reviewed example.
- Make Ralph infer task completion, add a judge, or make review part of the default Ralph workflow.
- Replace dirty-working-tree snapshots or commit-identity checks with standard-library calls that cannot preserve their semantics.

## Acceptance Criteria

- AC-001: `ralph.js` remains a caller-bounded, sequential, untyped, write-capable fresh-increment loop with an adaptable increment prompt and no inlined review workflow.
- AC-002: `ralph-reviewed.js` is an explicitly bounded, opt-in composition whose review section uses normalized Git evidence, bounded contexts and metadata, explicit assignment coverage, and decision reconciliation while reporting review gaps rather than treating them as success.
- AC-003: `pi-ralph` and `pi-review` bodies describe their ownership boundary, reference templates, prompt adaptation, profile/tool roles, and why default Ralph remains separate from review.
- AC-004: Package-load checks parse the Ralph templates and enforce their standard-library and separation contracts; relevant repository checks pass.

## Work Items

- [x] WI-001: Finish the canonical planned-review building block and its package contract checks.
- [x] WI-002: Add the adaptable Ralph increment prompt and harden the default bounded loop.
- [x] WI-003: Rebuild the opt-in reviewed Ralph composition around the canonical standard-library review semantics.
- [x] WI-004: Reconcile the skill bodies, test results, review, and evidence.

## References

- `.ledger/202608201212-upgrade-ralph-pi-exec-templates/plans/implementation.md`
- `skills/pi-ralph/SKILL.md`
- `skills/pi-ralph/references/ralph.js`
- `skills/pi-ralph/references/ralph-reviewed.js`
- `skills/pi-review/SKILL.md`
- `skills/pi-review/references/plan-review-verify.js`
- `tests/package-load.mjs`
- `skills/pi-exec/SKILL.md`

## Assumptions

- User-ratified: the current uncommitted pi-review standard-library enhancement and this Ralph enhancement are one commit and push.
- Record-backed: default Ralph and default review are intentionally separate; only the opt-in reviewed example composes them.
- Record-backed: standard-library use is justified only where it preserves or improves a real controller semantic; the default fixed loop needs no artificial `std` calls.

## Journal

- 2026-08-20: Created the task bundle.
- 2026-08-20: Inspected the in-progress review templates, Ralph references, pi_exec skill, package-load checks, and prior Ralph history. Fresh Explore and Plan agents confirmed the minimal two-template Ralph set and the source-backed implementation sequence.
- 2026-08-20: Shaped and activated the task with a plan; implementation is authorized by the user.
- 2026-08-20: Three isolated Implement agents completed the canonical review, default Ralph, and advanced Ralph surfaces. Independent fresh-context review found and the controller fixed coverage-overlap, bounded-feedback, carried-state, priority, and unknown-decision defects before closure.

## Blockers

None.

## Evidence

- AC-001: `ralph.js` parses as a pi_exec body; package-load checks confirm the untyped coding worker, explicit tools, strict safe iteration bound, adaptable increment prompt, and absence of review topology. `npm run test:loader` passed.
- AC-002: `ralph-reviewed.js` parses as a pi_exec body; package-load checks require normalized Git, context fit/pack, coverage/reconciliation, bounded feedback, and retained reviewed paths. It preserves dirty-tree snapshots and HEAD checks. `npm run test:loader`, `npm run typecheck`, `npm test`, `npm run pack:check`, and `git diff --check` passed. Runtime execution with a real adapted advanced loop is not verified.
- AC-003: Both skill bodies now document the default/advanced Ralph boundary, prompt adaptation, profiles, tools, budget, and review ownership. Inspected in this run.
- AC-004: `npm test` passed (652 unit tests, 110 advisor tests, loader); `npm run typecheck` and `npm run pack:check` passed. `npm run format:check` remains blocked by two pre-existing memory formatting failures; `npm run lint` remains blocked by a pre-existing `useYield` finding in `components/memory/tests/drain.test.ts`.

## Review

- Fresh-context review found coverage overlap falsely treated as incomplete, unbounded/erased review feedback, unbounded targeted verifier metadata, omitted candidate/gap reconciliation holes, severity starvation, invalid duplicate decisions, collapsed carried gap records, and discarded prior risks. Each was verified and corrected. After the final implementation increment, package-load, TypeScript, diff, and pi_exec parse checks passed; full behavioral execution of an adapted advanced template remains unverified.

## Retrospective

- The standard library improves this workflow only at real controller boundaries: normalized change evidence, serialized-size packing, coverage comparison, and reconciliation. Dirty-tree snapshots and commit detection remain raw Git because their semantics are not represented by the library.

## Distillation

- The reusable outcome belongs in the packaged `pi-review` and `pi-ralph` skill references and their package-load contract checks, which were updated. No separate documentation or runbook is warranted: these templates and tests are the production consumer and durable owner.

Status: active
Created: 2026-08-15
Updated: 2026-08-15

# Bootstrap implementation plan

## Outcome

Introduce canonical gated work items across task parsing, mutation, executor/review/judge output, receipts, and Ralph closure. Implement this plan with the main coding agent outside Ralph, validate and independently review it, then reload Pi before any dependent task is inspected or run under Ralph.

## Current-System Evidence

- `components/ralph/src/work-graph.ts` parses task sections and closure evidence but has no work-item model.
- `components/ralph/src/task.ts` owns queued digest-checked Markdown mutation.
- `components/ralph/src/lease.ts` leases canonical task-bundle resources during Ralph runs.
- `components/ralph/src/roles.ts` reads role skills from disk per role invocation while controller/parser modules remain loaded for the extension lifetime.
- `components/ralph/src/controller.ts` applies structured executor output before review and evaluates closure after judgment.
- `components/ralph/src/receipts.ts` validates schema-v2 transitions and immutable run state.

## Change Surfaces

- Add `components/ralph/src/task-document.ts` as the canonical parser for task title, headers, sections, criteria, and optional WI syntax/issues.
- Refactor `components/ralph/src/work-graph.ts` and `components/ralph/src/task.ts` to consume the parser rather than maintaining parallel Markdown interpretations.
- Add task-bundle mutation lease helpers in `components/ralph/src/lease.ts` and typed add/reorder/complete/reopen/cancel operations in `components/ralph/src/task.ts`.
- Extend `components/ralph/src/types.ts` with work items, issues, executor proposals, judge assessments, and additive receipt fields.
- Extend `components/ralph/src/roles.ts`, `skills/ralph-executor/SKILL.md`, and `skills/ralph-judge/SKILL.md` with exact structured output validation.
- Update `components/ralph/src/controller.ts` to validate proposals, include them in independent-review context, validate exact judge decisions, apply only confirmed completions, recompile, and gate closure on open/issues.
- Update `components/ralph/src/receipts.ts`, `docs/ledger.md`, `docs/ralph.md`, and focused tests.

## Sequence

1. Add characterization tests proving existing no-WI task compilation, mutation, receipt replay, and closure behavior.
2. Implement and test the canonical task parser and WI diagnostics; switch work-graph compilation to it without changing no-WI behavior.
3. Implement task-bundle leased, digest-checked typed work-item mutation and atomic failure tests.
4. Extend executor and judge structured schemas and skills; test unknown, duplicate, invalid-state, and invented-ID rejection.
5. Integrate proposal evidence into shared Review, exact judgment into controller mutation, additive receipt state, recompilation, rejected-ID objectives, and closure gates.
6. Update documentation and package checks.
7. Run targeted tests, typecheck, full tests, and pack check.
8. Obtain independent read-only review and validate every finding.
9. Mark this prerequisite done only when evidence and review gates pass, then reload Pi so controller, parsers, and role skills enter one coherent runtime.

## Acceptance And Backpressure

- AC-001: parser tests cover absent section, placement, all states, uniqueness, substantive content, malformed-looking rows, and stable IDs.
- AC-002: mutation tests cover every operation, foreign lease, drift, malformed pre-state, invalid transitions, and byte-for-byte unchanged failures.
- AC-003: role parser/controller tests prove proposals are exact, review receives evidence, judges assess exactly proposed IDs, and no internal actor gains unsupported mutation authority.
- AC-004: state-machine tests prove open/issues block closure despite complete AC evidence, confirmed IDs complete only after judgment, rejected IDs remain open, and no-WI tasks preserve prior behavior.
- AC-005: receipt tests load old schema-v2 events, validate new optional fields and sequence, reject forged work-item state, and retain schema-v1 audit-only handling.
- AC-006: skill, docs, loader, and full validation cover the new authority contract.

Per increment:

```text
npm run typecheck
npx vitest run tests/ralph-task-paths.test.ts tests/ralph-work-graph.test.ts tests/ralph-records.test.ts tests/ralph-state-machine.test.ts tests/ralph-work-items.test.ts
```

Final gate:

```text
npm run typecheck
npm test
npm run pack:check
```

## Risks And Failure Modes

- Running this task through legacy Ralph can close without WI gates or load new role prompts against old parsers. Do not use Ralph for this bootstrap.
- A second parser would create semantic drift; every consumer must use `task-document.ts`.
- Lease checking without acquisition leaves a race; outside-Ralph mutation must hold the task-bundle resource through CAS.
- Applying proposals before judgment manufactures completion; only confirmed IDs mutate.
- Receipt proposal state is not final task authority; crashes must leave `task.md` decisive.
- Reformatting or UI work in this prerequisite expands scope and complicates review.

## Integration Points

- Existing task ID/path validation in `components/ralph/src/task-paths.ts`.
- Existing task-bundle lease resources in `components/ralph/src/lease.ts`.
- Existing file mutation queue and digest CAS in `components/ralph/src/task.ts`.
- Existing shared Review authority packet and background in `components/ralph/src/controller.ts`.
- Existing role skill hashing and fresh-session execution in `components/ralph/src/roles.ts`.
- Existing schema-v2 receipt replay in `components/ralph/src/receipts.ts`.

## Rollback Or Recovery

- Keep parser/mutation changes separate from controller/role changes so a failed increment can return to the no-WI baseline before any task relies on WI gates.
- Once tasks with Work Items are in use, do not roll back closure support without migrating or resolving those records; legacy code would ignore open items.
- New receipt fields are optional and require no rewrite. Existing schema-v2 remains loadable.
- If validation or review fails, leave this task open and do not reload dependent Ralph execution as commissioned.

## Related Records

- `.ledger/202608151843-bootstrap-gated-work-items/specs/work-items.md`
- `.ledger/202608151843-bootstrap-gated-work-items/research/current-state.md`

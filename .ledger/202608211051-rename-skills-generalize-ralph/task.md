Status: active
Created: 2026-08-21
Updated: 2026-08-21

# Rename workflow skills and generalize Ralph

## Scope

Rename the 13 lifecycle skills to descriptive, 10x-aligned public names without the `ledger-` prefix; rename `pi-review` to `review` and `pi-ralph` to `ralph`; preserve `pi-exec`; replace cross-skill relative-path references with catalog names; and expose separate simple, Ledger, and Ledger-plus-review Ralph programs.

## Non-goals

- Compatibility aliases or duplicate old/new skill directories.
- Changing the established lifecycle methodology, Ledger authority model, review topology, or operator-owned integration boundaries.
- Removing relative links to support files owned by the same skill.

## Acceptance Criteria

- AC-001: Pi discovers exactly the approved catalog names: `task-shaping`, `implementation-planning`, `plan-execution`, `work-item-orchestration`, `parallel-orchestration`, `root-cause-debugging`, `test-first-development`, `review-commissioning`, `review-reconciliation`, `completion-verification`, `workspace-isolation`, `task-closure`, `skill-authoring`, `review`, `ralph`, and `pi-exec`.
- AC-002: Skill directories, frontmatter, root routing, docs, tests, attribution, and every cross-skill reference use the canonical names; cross-skill references name the skill rather than linking through relative paths.
- AC-003: Ralph ships `ralph-simple.js` for any bounded caller-owned goal, `ralph-ledger.js` for prepared Ledger tasks, and `ralph-ledger-review.js` for the opt-in reviewed Ledger loop, with honest bounded outputs and no worker-owned commit or integration authority.
- AC-004: Focused package, prompt, Ralph, type, and package-content checks pass, and no obsolete public skill name remains outside historical Ledger evidence where rewriting would falsify history.

## Work Items

- [x] WI-001: Rename the public skill bundles and update all active repository references and discovery assertions.
- [x] WI-002: Split and document the generalized Ralph program variants with executable coverage.
- [ ] WI-003: Run focused and package-level verification, reconcile review, and close the task honestly.

## References

- `README.md`
- `AGENTS.md`
- `components/shared/src/workflow-system-prompt.ts`
- `skills/`
- `tests/ledger-prompt-integration.test.ts`
- `tests/package-load.mjs`
- `tests/shared-primitives.test.ts`
- `package.json`

## Assumptions

- User-ratified: use descriptive phrases rather than terse action verbs or the Superpowers public names.
- User-ratified: use `task-shaping` rather than `design-shaping`.
- User-ratified: rename `pi-review` to `review`, `pi-ralph` to `ralph`, and retain `pi-exec`.
- User-ratified: Ralph must support both prepared Ledger tasks and arbitrary caller-owned goals through separate programs.
- Repository-backed: skill-relative support-file links remain valid; only cross-skill path references are replaced by catalog-name references.

## Journal

- 2026-08-21: Created the task bundle and inspected current package authority, skill catalog, Ralph programs, and 10x naming posture.
- 2026-08-21: Operator approved the descriptive naming map with `task-shaping` replacing `design-shaping`, plus the three-program Ralph split.
- 2026-08-21: Updated the loader expectations first and observed the expected RED failure: the package still exposed all former names.
- 2026-08-21: Renamed all 15 affected skill bundles, updated frontmatter and active repository references, removed cross-skill relative links, and retained `pi-exec` unchanged.
- 2026-08-21: Added `ralph-simple.js` plus its general increment prompt; renamed the existing programs to `ralph-ledger.js` and `ralph-ledger-review.js` and documented their distinct state ownership.
- 2026-08-21: Unrelated concurrent working-tree changes appeared after implementation in memory/model-profile tests and removed assertions from shared test files, including files this task also edits. They were preserved rather than reverted.
- 2026-08-21: Full `npm test` failed on the unchanged visual-companion WebSocket event-limit test at its 5-second timeout. The exact test passed once with a 15-second outer timeout, while the full unit suite with that outer timeout still hit the test's internal 5-second wait. No timeout or visual protocol code was changed.
- 2026-08-21: After disclosure of the full-suite timeout and unrelated concurrent changes, the operator explicitly instructed commit and push. The commit is limited to this task's paths and reconstructed rename-only hunks in shared test files; unrelated working-tree edits remain unstaged.

## Blockers

Closure is blocked on a clean default test-suite result or an operator ruling about the unrelated concurrent test changes and the visual-companion timeout. The requested skill and Ralph implementation is present, but the repository's default `npm test` oracle is not green.

## Evidence

- AC-001: `npm run test:loader` passed and loaded exactly the approved 16-skill catalog with directory/frontmatter identity.
- AC-002: Active-tree searches found obsolete names only in negative assertions and this task's rename provenance; no cross-skill `../` links or direct `skills/<other-skill>` references remain inside skill content.
- AC-003: The loader parsed all three Ralph programs, executed `ralph-simple.js` successfully without `inputs.task`, and confirmed `ralph-ledger.js` rejects a missing task.
- AC-004: `npm run typecheck`, `npm run pack:check` (234 files), `git diff --check`, the loader smoke test, and 114 focused tests passed. `npm test` remains failed because one visual-companion timing test timed out; this limits any full-suite claim.

## Review

Self-review found and corrected stale naming prose, malformed Markdown introduced during path-to-name conversion, and Ledger-only Ralph wording. Independent review was not commissioned for this bounded naming change. Unrelated concurrent edits remain outside this task's disposition.

## Retrospective

Broad textual rename scripts are appropriate only with immediate diff inspection. Although the skill-name substitutions were bounded, concurrent working-tree edits appeared during validation and made shared test-file attribution ambiguous; future rename work should snapshot the intended path set before each mutation and stop as soon as unexpected files become dirty.

## Distillation

Canonical names and generalized Ralph ownership are promoted to `README.md`, `docs/ledger.md`, `AGENTS.md`, the root workflow prompt, package tests, and each owning skill. No separate knowledge record is warranted. The task remains live because its verification blocker is unresolved.

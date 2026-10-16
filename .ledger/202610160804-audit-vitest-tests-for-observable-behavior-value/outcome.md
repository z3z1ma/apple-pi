# Outcome

## Approved scope

The operator approved addressing the removal candidates and similar instances, then closing, committing, and pushing. This completes that pruning scope; it is not an assertion that every remaining test has passed exhaustive body-level review. The first-pass report and file assignment remain in findings.md and scope.md as historical evidence.

## Changes

All changes outside this bundle and its index row are test-only. The Vitest suite decreased from **1,539 to 1,528 cases**, with all **146 files** retained.

Whole-case removals (11):

- One sidecar test implemented aggregation in the test rather than exercising production aggregation.
- Four RTK cases duplicated three direct-execution variants and the schema check; the retained set has a realistic cwd and retains the guideline assertion.
- One JavaScript saved-program exclusion duplicated the broader Python discovery/registration fixture.
- One historical input-footer exclusion duplicated the exact four-row rendering and viewport-border contracts. The actual no-bottom-rail requirement remains covered.
- One compaction-trigger case had an identical body to the retained exact-threshold/provider-growth case.
- Three wiki child-extension cases duplicated the ledger suite's exact standard/internal/paired child extension lists. Wiki-specific worker and pair-prompt checks remain.

Assertion pruning:

- Removed scheduler self-equality and its unobserved trailing no-op completion.
- Removed six receipt schema negatives already implied by exactly `["id"]`, an exclusion implied by exact body equality, and a regex implied by a stricter preceding regex.
- Removed the positive size-constant check, preserving actual record, privacy, and writing coverage.
- Replaced obsolete evidence API name bans with neutral unknown-function rejection.
- Removed historic code-review JavaScript-path and Python spelling bans, old-heading exclusions, and the old skill directory check. Retained actual skill loading/alias exclusion and executable packaged-program checks.
- Trimmed incidental TDD vocabulary and example-title locks; preserved loader checks and model-facing behavioral obligations.
- Removed notebook-local hook-list duplication; the repository-wide context-hook guard remains.
- Dropped a test-owned map-clear assertion and viewer-internal scroll-state comparisons; rendered scroll preservation remains tested.
- Replaced full generated close-hold wording equality with block/retry semantics and a distillation instruction check. The separate complete learning-ID/text assertion remains.

Stronger tests without adding cases:

- Native editor test now types, deletes, renders, and submits actual content instead of spying on an overridden superclass handler.
- Rail-color test distinguishes bashMode and accent styles rather than merely finding a rail glyph.
- Worker ownership test retains invalid/self PID rejections and recognizes a real owned worker while live, then rejects it after close. It can no longer pass with an always-false ownership function.

## Similar-instance search and judgment

A TypeScript AST scan covered the 146 discovered files for direct self-comparisons, repeated assertions within a block, and identical test bodies. Candidates were checked in context, not automatically removed. For example, two calls to `getActiveWorkSurface(pi)` legitimately test cached identity, and repeated assertions separated by input/state transitions are meaningful. Wiki and ledger pair-prompt bodies use different imported markers and protect different prompt exclusions; those were retained. The identical child extension lists and compaction bodies were removed.

This scan supplements, rather than replaces, the first-pass audit. Candidate-focused areas were not all reread line by line. The two test files with pre-existing active ledger changes were not edited or qualitatively audited; they were included in full-suite execution. Their associated production/doc changes remain unstaged.

## Verification

- `npm run test:unit`: **146 files, 1,528 tests passed**.
- `npm run typecheck`: passed (root and web TypeScript).
- `npm run format:check`: passed (Biome and Ruff).
- `npm run lint`: passed (Biome and Ruff).
- `npm run test:sidebar`: **22 passed**.
- `npm run test:pair`: **118/118 passed**, networked E2E skipped by its default opt-in gate.
- `npm run test:loader`: all extension entrypoints loaded.
- `npm run pack:check`: passed, 361 published files; test-only changes do not alter production inclusion boundaries.
- `git diff --check`: passed.
- Final targeted rerun of `tests/code-review-skill.test.ts` after the last assertion cleanup: **14 passed**.
- Independent read-only coverage-preservation review: no material findings; reviewer also ran editor, compaction-trigger, and worker-session tests (**82 passed**).

During iteration, the new editor test initially imported a type-only coding-agent keybindings export, then encountered the related nominal type mismatch. It now uses Pi TUI's real keybinding manager as the editor fixture; the behavioral tests and full typecheck pass. No failures remain from those iterations.

Not verified: networked pair E2E, Linux/Windows worker recognition, and actual terminal focus/interaction. No production code changed, and no runtime behavior change is claimed.

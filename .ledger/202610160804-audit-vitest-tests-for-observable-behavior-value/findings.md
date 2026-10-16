# Vitest value audit — first pass

This is the pre-implementation audit record. The operator subsequently approved pruning the removal candidates and similar instances, then closing the task. See [outcome.md](outcome.md) for the implemented decisions, retained coverage, validation, and remaining review limits.

## Purpose and decision rule

Find tests that add maintenance cost without protecting observable behavior. An observable contract is an outcome available to a user, model, calling component, or external integration—for example rendered content, tool results, persisted records, or refusal of an unsafe action. A negative assertion is valuable when the absence itself protects such a contract. Implementation choices and obsolete feature names are not contracts merely because a test asserts them.

This report recommends changes; it does not authorize or record their implementation. File and line references describe the checkout at the time of this audit.

## Evidence and limits

`npx vitest list --json` confirms 1,539 cases in 146 files. See [scope.md](scope.md) for the complete assignment of test files to review areas (called “lanes” below). This is a candidate audit, not proof that every remaining test earns its place. UI/tasks and root/boundary reviewers reported full test-file reads; agents/execution and shared/optional reviewers used inventories and assertion searches with targeted body/source reads. Memory/pair covered the inventory and targeted source. The root independently read the concrete candidates below and checked surrounding coverage/contracts. Two dirty files (`tests/ledger-add.test.ts`, `tests/ledger-history.test.ts`) were excluded to preserve active work. No test execution, production edits, or test deletions were performed.

## Recommended removal or consolidation

1. **Test-local aggregation** — `components/shared/tests/sidecar-usage.test.ts:190–243`, “aggregates into the baseline table columns.” Production builds individual records; the test itself implements the Map aggregation it asserts. Other cases already exercise record construction/writing. Remove this aggregation case rather than representing test-local arithmetic as production aggregation coverage.
2. **Exact duplicate RTK execution cases** — `components/rtk/tests/rtk.test.ts:128–169` and `:301–323`. Both sets call the same factory with omitted/false/true `verbatim` and assert the same `details.rtk` values. Keep one set (prefer the one supplying a realistic cwd). Preserve distinct tool-call-hook and displayed-command tests.
3. **Duplicate non-Python discovery exclusion** — `components/pi-exec/tests/pi-exec.test.ts:1302–1314`, “does not advertise JavaScript saved programs under the Python runtime.” `saved-programs.test.ts:256–285` already exercises session-start registration with `legacy.js` alongside a valid Python program and asserts only the valid program is registered. Remove the isolated duplicate, retain the broader registration test.
4. **Obsolete-name exclusion** — `components/pi-exec/tests/evidence.test.ts:254–258`, “has no coverage or reconcile guest functions.” The regex forbids arbitrary future names containing coverage/reconcile; that is not evidence of correct current helper behavior. Remove the historic-name restrictions. If unknown-function dispatch needs coverage, retain it as a neutral unknown-name rejection case, not a prohibition on specific discarded APIs.
5. **Self-comparison** — `components/pair-programmer/tests/review-scheduler.test.ts:478`, `expect(permit.reviewId).toBe(permit.reviewId)`. Cannot establish identity stability or any other behavior. Remove this assertion; retain rollback, pending-item and retry tests.
6. **Redundant schema negatives** — `components/pair-programmer/tests/receipt-expansion.test.ts:61–66`. Six absent-property checks add nothing after `Object.keys(properties)` equals `["id"]`. Remove those six assertions; retain the exact capability boundary and guidance assertions.
7. **Positive constant** — `components/shared/tests/sidecar-usage.test.ts:254`, `expect(SIDECAR_USAGE_MAX_BYTES).toBeGreaterThan(0)`. Does not exercise writing/rotation. Remove this assertion; preserve session-ID and usage extraction assertions in the same case.
8. **Historic implementation bans embedded in real execution tests** — `tests/code-review-skill.test.ts:190` checks no corresponding `.js` file exists; `:347` forbids `std.`, `create_task`, `coverage_compare`, and `reconcile_by_id` in Python source. The actual packaged programs are already executed in Monty with real stubs and fixture workers in this file. Remove historical spelling/file-extension bans; preserve execution, reconciliation, incomplete-evidence, and failed-lane tests. The `std.` regex can even reject harmless prose in a comment.

These are not all whole-test removals. Fewer assertions can be the right result without reducing the test count.

## Tests that need a different assertion, not deletion

- **Native editor input** — `components/input-editor/tests/input-editor.test.ts:283–295` spies on a superclass method and replaces it with a no-op. This proves forwarding, not preserved editing. `docs/input-editor.md:3` requires native editor behavior. Drive input and assert resulting editor content instead. Current rendering tests do not replace input-behavior coverage.
- **Bash-mode rail color** — `components/input-editor/tests/input-editor.test.ts:264–268`, “switches rail color to bashMode…” only checks a rail glyph and unchanged prompt text. Both hold with the wrong rail color. Assert the theme/style selection, since the color switch is an explicit UI contract.
- **Worker ownership validation** — `components/pi-exec/tests/session.test.ts:239–246` reportedly tests only rejected PID shapes. Before changing it, inspect the worker recognition and kill call path and add/locate the positive owned-worker case. An always-false implementation should not qualify as valid ownership handling. Candidate requires further root verification.
- **Prompt phrase inventories** — `tests/tdd-skill.test.ts:34–98`, `tests/code-review-skill.test.ts:326–345`, and `components/pi-exec/tests/guidance.test.ts`: exact example titles, words such as “tracer bullet,” and forbidden historic headings are copy-edit locks, not evidence of a better workflow. Keep loader/schema/executable-example checks and essential model-facing obligations. Do not pretend a keyword presence test establishes compliance with the instruction. These need deliberate pruning, not replacement by equally brittle synonym matching.

## Rejected or qualified recommendations

- **Keep the no-bottom-rail behavior** in `input-editor.test.ts:226–233`: `docs/input-editor.md:18` explicitly requires no bottom rail or separate footer. The historic project/branch/cost string list can be trimmed, but deletion of the whole requirement is not justified. The exact normal-card rows and line count already provide stronger coverage for the fixture.
- **Keep a context-hook regression guard**: notebook's exact hook-list check is implementation-shaped, but request-context mutation has a documented caching cost and `tests/context-hooks.test.ts` explicitly guards it. Do not classify the absence of context hooks as universally non-observable. The notebook-local exact list may be redundant with the repository-wide guard; changing its title/assertion is a small consolidation, not a major coverage removal.
- **Keep color checks when visual styling is the contract**: an ANSI assertion is not inherently an implementation test. The muted status style is distinct from status content.
- **Keep mouse-event forwarding tests**: letting selection/scrolling reach Pi is observable interaction behavior, even when the handler's expected result is undefined.
- Preserve negative tests around cancellation, stale session callbacks, off-lineage recall, hidden data, token-authenticated browser routes, trust/symlink confinement, model tool exposure, and failed/incomplete review outcomes. These protect real behavior.

## Next steps

1. Before pruning, obtain approval for the recommendations above. Remove only the identified cases or assertions, preserving the retained coverage named for each item.
2. Verify the worker-ownership candidate against production code and existing positive-path tests before deciding whether to change it. Treat the prompt-phrase recommendations as case-by-case judgments, not blanket deletions.
3. Complete test-body review in the sampled areas listed under Evidence and limits. Review the two excluded ledger test files after their active changes settle. Record additional findings or explicitly record that no candidates were found.
4. After approved test edits, run the affected Vitest files, then the full Vitest suite (`npm run test:unit`). Run formatting, lint, and typecheck for the changed files as applicable. Record actual results and any remaining gaps here; compare the new discovery count with the baseline without treating reduction as the success metric.

## Conclusion

This pass establishes concrete waste, not a large defensible deletion target. The test count alone is not evidence of poor coverage. Further reduction requires body-level review in the sampled areas and finding duplicated behavior, not removing negatives by syntax or accepting every reviewer suggestion.

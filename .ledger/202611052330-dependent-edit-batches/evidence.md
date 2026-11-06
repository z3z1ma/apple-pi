# Evidence and limits

## Result

The production matcher would defer calls in **59 of 1,200 assistant tool batches** in the fixed window. **Two** of those batches are already caught by the existing commit-beside-edit guard, leaving **57 newly flagged batches**. This is a count of proposed workflow refusals, not 57 proven stale reads or wrong answers.

The revised production matcher was replayed after the review fixes, over the identical fixed window: **the counts remain 59 / 1,200, including 2 already-refused staging batches**. The scan examined 312 mutation batches and 139 batches mixing mutation with read/shell work. It found no duplicate-writer conflicts, malformed JSON lines, unavailable working directories or matcher errors in the scanned session files. The three qualifying sessions are the tool-batch sample, not a measure of every active person. No copied entries were deduplicated in this run.

## Window and recurrence

Start: `eaa8e5e2` / **2026-11-04T16:01:52Z**, derived in task.md from the latest batching-relevant code and prompt lines. End: **2026-11-06T06:28:36Z**, before development of this candidate. Unrelated later toolbox additions do not reset this behavior window, per Tadhg's explicit direction.

`session_evidence` since that revision reported 28 learnings, 7 refusals, 21 failures and 3 saved-program calls. Two recorded learnings explicitly report the wider batching defect:

- `entry:01a18155-0ec7-71f5-9809-638184a366dd/4ae41673`, 2026-11-04T18:34:39.175Z: edit plus verification grep.
- `entry:01a18155-0ec7-71f5-9809-638184a366dd/9d96c546`, 2026-11-05T03:50:37.156Z: edits plus test runs, and an already-refused commit.

The read-only raw scan independently located the underlying call shapes, rather than treating those summaries as proof:

| Example | Reference | Timestamp UTC | Matched repository path |
| --- | --- | --- | --- |
| Edit plus grep of its file | `entry:01a18155-0ec7-71f5-9809-638184a366dd/eaccca1f` | 2026-11-04T18:28:55.740Z | `components/formal-verification/src/alloy.ts` |
| Edit plus tests of that file | `entry:01a18155-0ec7-71f5-9809-638184a366dd/7395debd` | 2026-11-05T02:39:28.932Z | `apps/agent-workplace/tests/reviews-backend.test.ts` |
| Edit plus tests of that file | `entry:01a18155-0ec7-71f5-9809-638184a366dd/e97f36e3` | 2026-11-05T02:52:09.260Z | `apps/agent-workplace/tests/world-code.test.ts` |
| Edit plus same-file read | `entry:01a18155-0ec7-71f5-9809-638184a366dd/6fb37d0e` | 2026-11-05T04:10:01.192Z | `components/session-state/tests/review-queue.test.ts` |
| Edit plus same-file read | `entry:01a18155-0ec7-71f5-9809-638184a366dd/fbd32c27` | 2026-11-05T04:10:08.211Z | `components/session-state/tests/review-queue.test.ts` |

Every matched batch's reference, timestamp, tool names, relative paths and conflict kind is in `scan-results.json`. No private transcript messages, shell commands, command output or file contents are retained. Four external scratch-script paths are redacted as `<outside-repository>`; their batch references remain. Reading raw logs for this scan was authorized by the organization root in the task thread, as recorded in task.md.

## Wrong refusals and missed cases

I inspected the shell commands for the proposed matches without copying them into this bundle. They name files being searched, tested, formatted, staged or executed. The two staging cases were already refused: `entry:01a18155-0ec7-71f5-9809-638184a366dd/9f08e61f` and `entry:01a18155-0ec7-71f5-9809-638184a366dd/bb7f5f42`. Four scratch-script executions are also same-path dependencies; their paths are not retained.

**No confirmed harmless literal-only shell mention was found in these matched records.** That does not establish zero false positives. Both same-file read examples could be intentional inspection of a different section, rather than verification of the changed section: intent cannot be inferred from the path alone. They are conservative deferrals, not established mistakes. A shell call that only prints a filename or reads historical git data would also be deferred by the candidate. The adoption judgment must include that cost.

The scan leaves **80** mixed mutation/read-or-shell batches unflagged. This is not 80 proven independent batches: some run a directory-wide test, use variables or otherwise depend indirectly on an edited file. The candidate deliberately misses those. It skips all shell calls with dollar expansion, backticks, heredocs or line continuations, and any command that changes directory away from cwd. Its lexer is not a shell interpreter. Nested codemode calls, symlink aliases and dependencies through imports are not covered. The scan describes assistant top-level batches only.

## Reproduce

From this branch's checkout:

```sh
node --import ./components/session-state/src/register.mjs \
  .ledger/202611052330-dependent-edit-batches/scan.mjs \
  /path/to/apple-pi /path/to/pi/agent/sessions \
  2026-11-04T16:01:52Z 2026-11-06T06:28:36Z
```

The script finds its owning checkout by walking to `.git`, imports the production matcher, streams session JSONL whose header cwd is the requested repository, filters by entry timestamp, and deduplicates identical entry-id/timestamp/call-payload hashes. It does not mutate source logs. Output is sanitized metadata only. Run it only with authority to read the requested sessions. The supplied window and the current matcher, not a hidden snapshot, determine the replay result.

## Design model and implementation tests

The design model `BatchGuard.tla` represents two independent writer/reader pairs and one independent reader, with arbitrary execution order and possible writer failure. Recognized observers are refused even after writer failure. It abstracts away path parsing, batch discovery and the duplicate-writer rule, which remain implementation tests.

- TLC 1.7.4, `Guard=TRUE`: PASS, 205 generated / 72 distinct states, depth 6, no actions reported inactive. `NoStaleCheck`, `IndependentPermitted`, `TypeOK` checked.
- Disabled-guard control, `Guard=FALSE`: `NoStaleCheck` violated in 2 states of the trace; the read executes before its writer. This is a checker control, not a claim that the model proves shell parsing.
- The corresponding implementation regression test (same-file read starts before edit) failed on detached base `e590247f`: expected `{block:true}`, got `undefined`. The identical test passed with the candidate.
- Revised focused suite: `vitest run components/repo-rules/tests components/system-prompt/tests tests/prompt-budgets.test.ts --maxWorkers=1`: **7 files / 54 tests passed**, including 45 repo-rules tests and four real-SDK host tests.
- Scanner synthetic suite: `node --test .ledger/202611052330-dependent-edit-batches/scan.test.mjs`: **4 tests passed**.
- The identical real-SDK test file on reviewed commit 73e95c72 failed three assertions (invalid-sibling independence, later message replacement, fork batch). The same scanner test file failed all four tests on that commit. The failed-writer/later-message host control already passed. Revised candidate passes every test.
- `tsc --noEmit`: passed after using the real ToolCall argument type in the test fixture.
- `npm run test:loader`: passed again after the repairs; all extension entrypoints loaded.
- Worktree `lintContext`: **651 context files, no findings**, rerun after context updates.
- Biome check ran on all seven changed TypeScript/JavaScript files; Markdown is not formatted by Biome.

No full-suite, live provider session, live daemon restart or future-behavior measurement has run. Real SDK tests use scripted model replies and temporary files, not credentials or the operator's state. The unchanged design model does not prove path parsing or batch discovery.

## Independent challenge and tested repairs

Captured review **review-6447efe0-3f56-4f7b-bb17-cefbf2c34203** completed four passes and eight questions against 73e95c72. It reported 13 finding records representing **11 distinct confirmed issues** (three records describe the same invalid-sibling defect). All were accepted and repaired in **7da47ad6**; all 11 confirmed findings received **fixed-claimed** responses (review summary revision 20: responded 11, addressed=true), because a fresh independent capture has not verified the repairs. Tadhg relayed the operator's explicit direction to finish the fixes, replay and sign-off without another full review round (communication:cf77b5cd4bfba2919f183eefb1e383af2b6b506efa8efeb4ce9bec26fa2183ba).

| Finding suffix / pass | Repair | Regression evidence |
| --- | --- | --- |
| matcher-2 / matcher-semantics | Quote-aware word decoding preserves adjacent segments and quote-specific escapes | Literal-shell table includes spaces, apostrophes, single/double-quoted backslashes, escaped double quotes and an independent backslash-file control |
| matcher-3 / matcher-semantics | Preserve equals-containing and dash-prefixed operands | `a=b.ts` and `cat -- -a.ts` cases |
| matcher-4 / matcher-semantics | Only command-position `cd` triggers directory exclusion | `grep cd batch-a.ts`; existing real cd-away control remains |
| matcher-5 / matcher-semantics | Split only ASCII shell separators | Independent unquoted NBSP filename case |
| lifecycle-1 / host-event-lifecycle | Fork-aware executing conversation replaces shared batch state | Real startFork refusal, then parent read with the same call id succeeds |
| lifecycle-3 / host-event-lifecycle | Read finalized executing message during tool_call | Real SDK message_end transformer adds a reader, which is refused |
| E1 / evidence-audit | Per-record error isolation plus fixed fatal diagnostics | Sentinel arguments and fatal-path diagnostics never appear in output |
| E2 / evidence-audit | Safely exclude unavailable unrelated cwd, preserving existing alias resolution | Qualifying batch survives a later removed unrelated directory |
| E3 / evidence-audit | Count a Set of qualifying session ids | Overlapping copies yield one session, two unique batches, one duplicate |
| F1 / integration; matcher-1 and lifecycle-2 duplicates | Leave unresolvable siblings to their own call's error path | Invalid reader/writer fixtures and real SDK independent read/shell success |
| F2 / integration | Always-present batch guidance beside repository opt-in text | Prompt assertions with and without `.pi/rules/`; prompt budgets pass |

The final replay imported this repaired matcher. Sanitized output adds explicit unavailable-directory and matcher-error counts plus an empty `unclassified` list; all are zero/empty for this historical sample. Privacy and deduplication tests demonstrate supported failure behavior, not an assertion that private data was exposed in the original historical replay.

## Adoption and main integration

The operator approved sign_off_task on 2026-11-06 with no annotations. The tool reported all six Markdown documents unopened; this is an adoption verdict, not proof of full document inspection. Only the candidate's files were brought onto main. Its runtime wording was shortened during integration at Tadhg's direction, retaining all batch-contract concepts and opt-in consent. Main then passed **55 focused Vitest tests**, **four scanner tests**, typecheck, loader, seven-file Biome and 651-file context lint. The root prompt is **34,367 / 34,384 estimated tokens**, with the existing ceiling unchanged. The candidate worktree had 54 focused tests; the newer main contains one additional test. No behavior or replay matcher changed during this wording adjustment, and no new full review was started.

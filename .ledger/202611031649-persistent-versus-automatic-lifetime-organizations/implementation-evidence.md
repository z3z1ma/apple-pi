# Runtime, bridge and backend evidence

2026-11-06. Niamh's source cut; Tadhg owns the web menu, bundled app, integrated review and live activation. See [lifecycle-design.md](lifecycle-design.md) for the pre-code model and its limits. This record does not authorize a shared restart.

## Implemented boundaries

- Migration 54 protects every existing sessions row, including at-home roots/reports. New rows default unincorporated. Incarnations record interactive provenance; recognized close and incarnation end commit together.
- Current interactive quit or recorded explicit closing can start root dissolution. Process/socket loss, runtime restart and ambiguous headless quit do not. Selection and permanent commit both recheck current root/incarnation, membership, idle/input, held work, owned reviews, reports and program resources.
- Existing retire/cleanup owns permanent markers, process proof, files and row removal, with handoff false. Reports finish first; root last. Automatic notices address only the operator, avoiding self-generated turns/reopen in the closing tree. Unassigned backlog survives without blocking.
- Reopen/incorporation cancels future departures; committed departures stay permanent. Splits retain the current source incorporation; merges adopt the target. A per-incarnation startup marker prevents an old flagged process from incorporating a later merge target when reconnecting.
- `--incorporate`, `/incorporate`, and the query-only Workplace lifetime reader/fixed operator mutation share the runtime-owned state. Stale nonroot mutation targets are refused.

## Seen checks

[Retained focused and regression output](implementation-tests.txt).

| Check | Actual result |
| --- | --- |
| Lifecycle/model-adapter tests, roles, prompt budgets, migration/event index | 74 passed, four files, 29.78s |
| Existing departure lifecycle, departure guards, organization moves, liveness, runtime, program peers | 64 passed, six files, 101.82s |
| `npm run typecheck` after the fixture adoption | Both root and web TypeScript configurations passed |
| `npm run test:loader` | All extension entrypoints loaded; checks boolean flag and slash-command registration |
| Scoped Biome | 14 files checked, no fixes/errors; one existing informational useTemplate suggestion in package-load.mjs:542 remains outside this change |
| Scoped source-comment check and `git diff --check` | Passed |
| `context_lint` | Tool reported all 661 context files passed |
| `npm pack --dry-run --json` | 2,809 entries; inspected inclusion of organization-lifetime.ts, bridge.ts and docs/organization.md |

Focused command:

```sh
NODE_OPTIONS="--import=$PWD/components/session-state/src/register.mjs" \
  timeout -k 5 180 ./node_modules/.bin/vitest run \
  components/session-state/tests/organization-lifetime.test.ts \
  components/organization/tests/roles.test.ts tests/prompt-budgets.test.ts \
  components/session-state/tests/event-index.test.ts --maxWorkers=1
```

Regression command:

```sh
NODE_OPTIONS="--import=$PWD/components/session-state/src/register.mjs" \
  timeout -k 5 300 ./node_modules/.bin/vitest run \
  components/session-state/tests/departure-lifecycle.test.ts \
  components/session-state/tests/departures.test.ts \
  components/session-state/tests/organization-move.test.ts \
  components/session-state/tests/liveness.test.ts \
  components/session-state/tests/runtime.test.ts \
  components/session-state/tests/program-peers.test.ts --maxWorkers=1
```

The lifetime cases use isolated real Runtime/SQLite/socket/file cleanup and owned stand-in processes with scripted bridges. The SDK case executes the real slash handler with a supplied fixture flag and zero model requests. Migration checks the three named root IDs and sleeping reports in a disposable historical database, not the live database. The existing departure regression includes actual scripted SDK child hosts and OS exit.

## Failed checks and corrections

- The initial reopen fixture waited for an existing row instead of the replacement PID. The corrected barrier observes the new admitted incarnation before checking cancellation.
- Initial restart cleanup expected the restarted runtime to signal a live writer without an exclusive binding. The existing guard correctly kept it. The test now requires blocked cleanup and retained bytes, explicitly exits its owned stand-in, then requires cleanup. Runtime.stop is called once per fixture instance because its lock close is not idempotent.
- Prompt budget initially exceeded the unchanged 34,384-token ceiling by ten tokens, then by two after restoring the tested direct-work/delegation wording. Shortened equivalent staffing prose; final budget and all role cases passed. No ceiling changed.
- The first regression run had 63 passed/one failed: an independent asleep no-handoff fixture closed an unincorporated root, then requested manual departure after automatic departure had already committed. A filtered retry passed before the liveness poll; it was not evidence of retention. The fixture now incorporates that root before closing, establishing the manual-retirement precondition through a checked real command. The fresh six-file run passed 64/64.

## Not established

No full repository suite, paid provider turn, installed-tarball execution, native CLI flag parsing, physical terminal-window close, production process kill or live migration was run. Pack inclusion is inventory, not installation proof. The finite TLC pass/control is design safety evidence, not implementation refinement or eventual cleanup proof.

Tadhg must rebuild/commit the UI and dist, complete integrated review, and own any approved runtime restart. Activation must verify the retained live rsi/Tadhg, fq-squad/Nana and reporting/Bram roots as incorporated, including at-home organizations, then reload bridges and reopen Workplace as needed. These source checks do not claim that activation happened.

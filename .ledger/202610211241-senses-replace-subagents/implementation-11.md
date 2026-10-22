# Ticket 11 implementation notes

The approved scope is [ticket 11](tickets/11-subagents-removed.md) and the [specification](spec.md#removing-subagents). This is a removal and ownership change, not another approval gate.

## Optional extensions

The operator approved deleting `optional-extensions/` and its related tests during implementation. This replaces the earlier Todos-to-peers migration plan. The Todos and Backlog sources, tests, three feature documents, package allowlist entries, TypeScript/Vitest inclusion entries, and formatting/lint paths are removed. The package loader no longer loads or asserts those optional packages. The README and repository guide no longer advertise them; boundaries records the single assigned-work model.

The operator's global settings contain no reference to these optional extensions. No live session or runtime has been restarted. The package loader, context-hook test, Node/web typecheck, and package dry run passed; the tarball listing contains no optional extension source or removed feature documents. The third-party notice retains historical attribution without pointing to removed files. Logs are `/tmp/apc11-optional-{loader,test,types,pack}.log`.

## Intern runner

The intern tools now own `components/interns/src/runner.ts`. The old worker resolver, custom-agent loading, profile/tool/system-prompt overrides, context fitting adapter, and structured-return process extension are removed from `pi-exec`; programs already use peers. Interns keep the quick profile, their fixed prompts, the explicit extension set, private supplied material, shared event observation, and SIGTERM cleanup. Lifecycle hooks await process closure, including overlapping cancellation, while hiding cancelled calls from the activity display.

The move exposed a concrete mismatch: the existing prompt and `docs/interns.md` promise a shell for inspection and source retrieval, but the reused read/grep/find/ls constant omitted it. The CLI assertion failed before the correction (`/tmp/apc11-intern-shell-red.log`); the new fixed tool set includes bash and excludes edit/write. All 20 focused tests passed, including real fixture process death on Esc and shutdown (`/tmp/apc11-intern-green.log`). Context lint passed (127 files), and Node/web typecheck and loader passed. The six intern checks were rerun after strengthening shutdown coverage to await the second of two overlapping shutdown events (`/tmp/apc11-intern-lifecycle-final.log`).

## Private BTW session

`components/btw/` and `extensions/btw.ts` now directly own one in-memory SDK session. The old manager no longer registers the command; its BTW source, viewer, and two test files are removed. The overlay retains its layout, streaming answers, follow-up composer, copy/injection, stop, clear, and dismiss behavior. Parent context remains an append-only per-visit delta. The selected parent model runtime is borrowed, not disposed; only fast mode and mandatory safety extensions load. Native SDK statistics replace the old lifetime accumulator.

Lifecycle tests cover a session created after navigation, overlapping clear/shutdown, active-turn cancellation, cancellation during prompt preparation and automatic compaction, and parent usability after BTW closes. A failed preflight originally reported the question as accepted; the red test is `/tmp/apc11-btw-accept-red.log`. Acceptance now follows the native run-start event, so failed questions retain their parent snapshot for retry. Stop aborts both before and after that boundary: compaction may already be active, or a prompt may still be preparing before cancellation can reach its run. Slash-led questions remain literal during steering.

All 28 BTW checks passed (`/tmp/apc11-btw-startup.log`), including real SDK turns and compaction on the faux model. The preceding run passed 88 checks across BTW and the surviving legacy subagent suite, plus Node/web typecheck and package loading (`/tmp/apc11-btw-{final,types-final,loader}.log`). Post-change Node/web typecheck and loader passed (`/tmp/apc11-btw-{types-complete,loader-complete}.log`); the package dry run lists all six new runtime files and no removed BTW source paths (`/tmp/apc11-btw-pack.log`). Repository format/lint checks passed with the existing notch-test warning; context lint passed for 129 files. No paid model or live runtime was used.

## Remaining owners

- The work panel keeps Tasks and Pi Exec. Remove the Agents view, active-agent rendering/count, public conversation inspection, four tools, and team/profile prompt sections.
- Remove the in-process child context, notebook capability, completion reflection, nesting, and clarify paths. Update root-only guards and bridge behavior at their owners; ordinary peers are root sessions.
- Remove the approved global `grafana-debugger.md` definition. Update packaging, current docs, and tests for the surviving behavior.

The dependency inventory covered `components`, `extensions`, `optional-extensions`, `apps`, `tests`, `scripts`, `skills`, and `docs`, plus package/build declarations. Scratch inventories: `/tmp/apc11-inventory-paths.txt`, `/tmp/apc11-dependencies.txt`, and `/tmp/apc11-optional-references.txt`. Keep historical ledger records as history rather than rewriting them to pretend subagents never existed.

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

## Removal complete

The remaining `components/subagents/` tree and extension are deleted, along with public delegation tools, definition/settings loading, child context, nesting, clarification, completion reflection, shared notebook writes, and the Agents panel/widget/count. The work panel keeps Tasks and Pi Exec. `/btw` owns its separate overlay. Bridges now report root sessions only; the native BTW test proves its private session creates no extra person or incarnation. Interns omit the bridge. Historical child rows and notebook source decoders remain readable rather than rewriting or discarding old evidence.

Skills now use intern tools, explicit peer assignments, or Python peer calls. A repository guidance test catches obsolete native-tool instructions, including the hyphenated `sub-agents` spelling, while allowing Python's retained `agent` function. The approved global `grafana-debugger.md` file is deleted. Package entries and attribution paths match the remaining owners. The comprehensive product documentation pass is ticket 14.

Two replacement consumers needed more than deletion. The pair scheduler now recognizes explicit hiring/assignment and successful intern answers instead of polling states. Search forks keep the parent's identity and handlers, so new workplace actions and interns must be blocked there: otherwise an isolated candidate can hire, send mail, consume unread markers, or run an intern in the parent's directory. The native fork test failed with those actions executing before the correction (`/tmp/apc11-fork-policy-red.log`). The fixed policy and intern-review tests passed in the focused run.

## Final checks

- Work panel, status line, private session, and prompt sections: 78 checks across five files (`/tmp/apc11-removal-ui.log`).
- Pair scheduling, notebook recall, search forks, reflection, formatting, Python tool boundaries, skills, MCP, and prompt integration: 235 checks across 21 files (`/tmp/apc11-removal-focused.log`).
- Runtime, organization, naming, tasks, prompt stash, tmux integration, BTW, and interns: 270 checks across 44 files (`/tmp/apc11-root-owners.log`).
- Offline pair harness: 112/112, networked E2E intentionally skipped (`/tmp/apc11-pair-harness.log`).
- Node/web typecheck, repository formatting, lint, and package loading passed. Lint retains the existing notch-test template-string warning. Logs: `/tmp/apc11-removal-{types-final,format,lint,loader-final}.log`.
- Package dry run includes the intern and BTW runtime files and contains no subagent or optional-extension source (`/tmp/apc11-removal-pack.log`). Context lint passed for 131 files.

No full `npm test` has run yet; it remains the end-of-task check. No paid model or live operator runtime/session was used or restarted. This long-running session still has its old tool declarations, so current registrations and the specification, rather than that cached catalog, govern renamed tools.

The dependency inventory covered `components`, `extensions`, `optional-extensions`, `apps`, `tests`, `scripts`, `skills`, and `docs`, plus package/build declarations. Scratch inventories: `/tmp/apc11-inventory-paths.txt`, `/tmp/apc11-dependencies.txt`, and `/tmp/apc11-optional-references.txt`. Keep historical ledger records as history rather than rewriting them to pretend subagents never existed.

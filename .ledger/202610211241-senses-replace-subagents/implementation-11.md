# Ticket 11 implementation notes

The approved scope is [ticket 11](tickets/11-subagents-removed.md) and the [specification](spec.md#removing-subagents). This is a removal and ownership change, not another approval gate.

## Optional extensions

The operator approved deleting `optional-extensions/` and its related tests during implementation. This replaces the earlier Todos-to-peers migration plan. The Todos and Backlog sources, tests, three feature documents, package allowlist entries, TypeScript/Vitest inclusion entries, and formatting/lint paths are removed. The package loader no longer loads or asserts those optional packages. The README and repository guide no longer advertise them; boundaries records the single assigned-work model.

The operator's global settings contain no reference to these optional extensions. No live session or runtime has been restarted. The package loader, context-hook test, Node/web typecheck, and package dry run passed; the tarball listing contains no optional extension source or removed feature documents. The third-party notice retains historical attribution without pointing to removed files. Logs are `/tmp/apc11-optional-{loader,test,types,pack}.log`.

## Remaining owners

- Interns keep their fixed prompts, the quick profile, explicit extension set, final-text return, activity, and graceful one-shot process cleanup. Move the remaining runner out of `pi-exec`; remove custom agent discovery and unused worker schema/override plumbing.
- `/btw` keeps one private read-only session directly. Preserve its view, follow-up, stop, dismiss, and lifecycle tests while removing its dependence on AgentManager and AgentRecord.
- The work panel keeps Tasks and Pi Exec. Remove the Agents view, active-agent rendering/count, public conversation inspection, four tools, and team/profile prompt sections.
- Remove the in-process child context, notebook capability, completion reflection, nesting, and clarify paths. Update root-only guards and bridge behavior at their owners; ordinary peers are root sessions.
- Remove the approved global `grafana-debugger.md` definition. Update packaging, current docs, and tests for the surviving behavior.

The dependency inventory covered `components`, `extensions`, `optional-extensions`, `apps`, `tests`, `scripts`, `skills`, and `docs`, plus package/build declarations. Scratch inventories: `/tmp/apc11-inventory-paths.txt`, `/tmp/apc11-dependencies.txt`, and `/tmp/apc11-optional-references.txt`. Keep historical ledger records as history rather than rewriting them to pretend subagents never existed.

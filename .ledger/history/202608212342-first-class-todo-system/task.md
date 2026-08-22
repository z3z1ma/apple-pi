Status: done
Created: 2026-08-21
Updated: 2026-08-21

# Build first-class to-do system

## Intent

Give apple-pi a first-class to-do experience for visible, model-assisted execution tracking, using tintinweb/pi-tasks as the behavioral and visual baseline while integrating with apple-pi's existing workflow surfaces.

## Outcome

A cohesive to-do component with model tools, a polished TUI, appropriate persistence, and direct integration with apple-pi's subagent and status surfaces. It has a clear relationship to the session backlog and durable Ledger rather than creating ambiguous duplicate authority.

## Scope

- Keep three explicit layers: backlog for parked ideas, to-dos for active execution checklists, and Ledger for durable project intent and evidence.
- Adapt the full useful baseline from tintinweb/pi-tasks: CRUD, widget, manager, dependencies, reminders, data-only configuration, branch-aware session persistence, optional shared project persistence, subagent execution, auto-cascade, and behavioral tests.
- Expose one apple-pi-native lowercase `todo_*` model-tool surface rather than Claude-compatible aliases.
- Integrate task execution and live progress with apple-pi's owned subagent implementation.
- Add explicit promotion paths between backlog, to-dos, and Ledger where those transitions have clear authority.
- Add package registration, documentation, validation coverage, and third-party provenance.

## Non-goals

- Preserve compatibility with an external pi-tasks installation, its tool names, or its storage format.
- Import dead or unsupported paths solely for upstream parity, including the unwired generic process tracker.
- Turn Ledger Markdown into a runtime database or make to-dos a second source of durable project intent.

## Acceptance Criteria

- AC-001: Users and the model can create, inspect, update, complete, delete, and order or relate to-dos through documented first-class surfaces.
- AC-002: The TUI persistently communicates open, active, blocked, and completed work and provides a complete human management flow.
- AC-003: Persistence, session switching, branching or sharing semantics are explicit and covered by behavioral tests.
- AC-004: To-do execution integrates with apple-pi subagents without a duplicate agent runtime or an optional external dependency.
- AC-005: Backlog, to-do, and Ledger responsibilities are distinct in behavior, prompts, and documentation.
- AC-006: Package loading, published files, TypeScript, formatting, linting, relevant tests, and package dry-run validation pass.
- AC-007: Copied or adapted upstream source is recorded with commit, license, original notice, local paths, and adaptation summary.

## Constraints

- Reuse apple-pi UI, lifecycle, tool-schema, configuration, and subagent conventions where they already exist.
- Maintain one implementation of each responsibility; do not install pi-tasks as a second extension or retain parallel legacy/new paths.
- Prefer coherent vertical increments and prune reference complexity that has no production consumer.
- Session persistence must follow Pi branch semantics; project persistence is an explicit opt-in shared mode with safe concurrent mutation.
- To-do execution must use apple-pi's owned subagent runtime, not an optional external extension or duplicate process manager.
- Invalid dependency graphs must not silently become executable workflow authority; precise validation behavior belongs in the implementation plan.

## References

- <https://github.com/tintinweb/pi-tasks>
- Reference checkout inspected at commit `86a559c` (`v0.8.0`).
- `research/pi-tasks-baseline.md`
- `docs/backlog.md`
- `docs/ledger.md`
- `docs/boundaries.md`
- `docs/subagents.md`
- `docs/status-footer.md`

Status: done
Created: 2026-09-19
Updated: 2026-09-20

# Polish managed tasks and subagent active-work UI

## Intent

Deliver a polished, first-class terminal experience for session-local managed tasks and public subagents. Keep the prompt editor as the bottom-most anchor, provide terse active-work counts in its metadata row, show passive live activity above it, and move focused inspection and control into explicit domain commands.

## Current State

All four tickets are implemented in the working tree. The final HEAD-based working-tree review found no remaining material Standards or Intent / Spec defects after corrections for tiny-terminal height bounds, configured-key hints, complete task-detail wrapping, queued-agent timing, active-state ownership, and multiline passive summaries. Full repository validation passes. The opt-in networked pair E2E was not run. The operator asked for all remaining tickets to be implemented in this run without subagents.

## Outcome

The prompt editor is again the bottom-most surface. Public active subagents and managed tasks share one passive above-editor projection and non-zero metadata counts; settled outcomes leave that passive UI. `/agents` provides a stable public-agent roster, conversation inspection, steering, confirmed stopping, and type browsing. `/tasks` provides an active-first task roster, kind-specific live detail, complete wrapped inputs, rolling output and full-output paths, monitor delivery state, and confirmed cancellation. Native editor navigation is no longer intercepted.

## Decisions

- The prompt editor remains the absolute bottom anchor; managed tasks and subagents render nothing below it.
- The editor metadata row shows terse non-zero `agents:N` and `tasks:N` active counts.
- Passive active work appears above the editor and excludes settled-work linger that duplicates transcript notifications.
- `/agents` and `/tasks` are deliberate management entrypoints with shared roster navigation and domain-specific detail/actions.
- Agent details support inspection, steering, and stopping; task details support output/status inspection and cancellation.
- A generic `/work` hub and a prototype are outside the approved scope.

## Tickets

- `tickets/01-move-subagent-activity-above-editor.md`
- `tickets/02-build-first-class-subagent-manager.md`
- `tickets/03-add-managed-tasks-to-active-work-surfaces.md`
- `tickets/04-build-first-class-managed-task-manager.md`

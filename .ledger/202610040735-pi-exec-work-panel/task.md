Status: ready
Created: 2026-10-04
Updated: 2026-10-04

# Expose Pi Exec work in the shared work panel

## Intent

Add a program-first Pi Exec tab to the shared Ctrl+W work panel. Expose live host calls and model-worker tool detail, retain settled results for session-local inspection, include saved programs, and integrate passive activity into the existing shared surface. See [spec.md](spec.md) for scope and acceptance criteria.

## Current State

Specification written. The operator authorized this new task and confirmed both test seams: automated execution-to-panel integration and real fullscreen Pi through tmux.

The existing [responsive-work-panel task](../202610030836-responsive-work-panel/task.md) remains separate. No production code or tests were changed, and no implementation checks were run in this specification step.

## Outcome

Ready for `/skill:to-tickets`: use this task's [specification](spec.md) to create implementation tickets in this bundle. Ticket generation is the next step, not yet performed or authorized by the specification write. Implementation is not started. Acceptance requires the specified behavior to pass both confirmed seams, plus relevant regression and package checks. Program/worker steering, new cancellation controls, and debugger features are outside this inspection-first scope.

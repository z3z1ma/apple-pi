Status: ready
Created: 2026-10-04
Updated: 2026-10-04

# Expose Pi Exec work in the shared work panel

## Intent

Add a program-first Pi Exec tab to the shared Ctrl+W work panel. Expose live host calls and model-worker tool detail, retain settled results for session-local inspection, include saved programs, and integrate passive activity into the existing shared surface. See [spec.md](spec.md) for scope and acceptance criteria.

## Current State

All three implementation tickets are committed:

- `9de7433` — program and host-call inspection in Ctrl+W.
- `0165591` — live model-worker tool inspection.
- `f37f281` — shared passive activity for Pi Exec, public agents, and managed tasks.

The operator confirmed the automated execution-to-panel and real fullscreen Pi seams before implementation. Both seams were exercised, and independent Standards and Intent reviews were reconciled. The responsive-work-panel undertaking remains separate.

## Outcome

Delivered the program-first Pi Exec tab, direct and saved-program inspection, live worker tools, retained results and traces, lifecycle cleanup, and one shared passive active-work surface. Execution ownership, disclosure boundaries, and inspection-only controls remain intact.

Formatting, lint, typecheck, package checks, and focused checks passed. Fullscreen checks demonstrated active inspection, worker correlation, responsive placement, preserved editor input, and selective passive cleanup.

Validation limitation at closure: the latest full suite passed 1,543 of 1,544 tests. `components/tasks/tests/tasks.test.ts` failed “terminates foreground command and throws when aborted” because it expected `Command aborted` but received `This operation was aborted`. That test passed when rerun individually; timing sensitivity is suspected, not proven. The failure was not fixed or established as pre-existing. The operator explicitly requested the final commit and task closure with this limitation recorded.

Program/worker steering, new cancellation controls, and debugger features remain out of scope.

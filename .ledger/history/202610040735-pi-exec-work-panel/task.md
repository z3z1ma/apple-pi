Status: done
Created: 2026-10-04
Updated: 2026-10-04

# Expose Pi Exec work in the shared work panel

## Intent

Add a program-first Pi Exec tab to the shared Ctrl+W work panel. Expose live host calls and model-worker tool detail, retain settled results for session-local inspection, include saved programs, and integrate passive activity into the existing shared surface. See [spec.md](spec.md) for scope and acceptance criteria.

A program is one direct `pi_exec` snippet or saved `program_*` invocation. A host call is an operation the script delegates to Pi, such as a tool, HTTP request, or model worker. A model worker is a program-owned agent, distinct from a public agent in the Agents tab. Passive activity is the above-editor summary; focused inspection is the detailed Ctrl+W panel.

## Current State

All three implementation tickets are committed:

- `9de7433` — program and host-call inspection in Ctrl+W.
- `0165591` — live model-worker tool inspection.
- `f37f281` — shared passive activity for Pi Exec, public agents, and managed tasks.

The operator confirmed two test boundaries before implementation: automated checks from registered execution to the rendered panel, and interactive checks in real fullscreen Pi through tmux. Both seams were exercised, and independent Standards and Intent reviews were reconciled. The responsive-work-panel undertaking remains separate.

## Outcome

Delivered the program-first Pi Exec tab, direct and saved-program inspection, live worker tools, retained results and traces, lifecycle cleanup, and one shared passive active-work surface. Execution ownership, disclosure boundaries, and inspection-only controls remain intact.

Formatting, lint, typecheck, package checks, and focused checks passed. Fullscreen checks demonstrated active inspection, worker correlation, responsive placement, preserved editor input, and selective passive cleanup.

Validation limitation at closure: the latest full suite passed 1,543 of 1,544 tests. `components/tasks/tests/tasks.test.ts` failed “terminates foreground command and throws when aborted” because it expected `Command aborted` but received `This operation was aborted`. That test passed when rerun individually; timing sensitivity is suspected, not proven. The failure was not fixed or established as pre-existing. The operator explicitly requested the final commit and task closure with this limitation recorded.

Program/worker steering, new cancellation controls, and debugger features remain out of scope.

No further feature implementation is pending in this task. For a separate investigation of the validation limitation, rerun `npx vitest run components/tasks/tests/tasks.test.ts -t 'terminates foreground command and throws when aborted'` and `npm test`; compare isolated and full-suite outcomes before assigning a cause or claiming a clean suite.

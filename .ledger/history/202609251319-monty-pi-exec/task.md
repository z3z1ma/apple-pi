Status: done
Created: 2026-09-25
Updated: 2026-09-27

# Replace pi_exec JavaScript VM with Monty Python sandbox

## Intent

Replace the node:vm JavaScript guest of `pi_exec` with a Monty Python sandbox. Keep the harness semantics (envelope, agents, traces, UI, saved programs) and remove the self-built JS runtime.

## Current State

Research and spike done; see `plan.md`. Operator decisions (2026-09-25):

- D1: clean rewrite to Python, no JS fallback.
- D2: one live session per root session, with a way to reset it and to recover it when a bound is hit.
- D3: type checking always on.
- D4: rewrite the `pi-fabric` row in `docs/boundaries.md`.

Tickets 01–06 are complete. The tree and `reset` are the only restore points; Monty's own dump limit is the only size bound. Spike scripts live in `/tmp/monty-probe` (not in the repo).

## Outcome

`pi_exec` now runs type-checked Monty Python with core and extension tools, model workers, HTTP, evidence helpers, and typed saved programs. One live interpreter follows the root Pi session tree; authenticated checkpoints restore after reload and navigation. Terminal failures report rollback without claiming to undo completed external effects. Python review and Ralph programs replace the JavaScript references. The prior Node VM and explicit JSON state IDs are removed. See each ticket for acceptance evidence and `docs/exec.md` for the user contract.

Validation on 2026-09-27: format check, lint, typecheck, 1,096 unit tests, 121 pair checks, package-loader smoke, package dry-run, and an extracted-tarball loader smoke passed. An isolated offline tarball install was blocked by an uncached transitive dependency; the extracted tarball loaded against the checkout's installed dependencies.

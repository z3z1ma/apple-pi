Status: done
Created: 2026-09-19
Updated: 2026-09-19

# Replace self-reminders with managed scheduling

## Intent

Replace the root-only `remind_me` continuation tool with one one-shot `schedule` tool that schedules either a self-authored prompt or a bash command after a relative delay. Scheduled work shares the existing managed-task ID, inspection, cancellation, cleanup, and command-completion wake-up lifecycle.

Acceptance criteria:

- `schedule` accepts exactly one `prompt` or `command` plus `delay_seconds`.
- A zero-delay prompt preserves next-turn continuation: it waits until the active run settles, wakes once, and remains clearly self-authored rather than operator authority.
- A scheduled command starts without waking the model and wakes it on completion or failure through the existing task notification path.
- `task` lists and inspects prompt and command schedules and cancels scheduled or running work through one `cancel` action.
- Scheduling is root-only, one-shot, relative, in-memory, and cleared on fork, tree navigation, session switch, and shutdown.
- `remind_me` and its standalone extension/component are removed from the default package.
- Neither `schedule` nor `task` is captured into the `pi_exec` guest extension-tool environment.
- Documentation, package loading, formatting, types, tests, and package contents reflect the new surface.

## Current State

Implementation and validation complete. The reminders component and extension are removed; scheduling now belongs to the root tasks extension. Managed tasks cover scheduled prompts, scheduled commands, and immediate background commands. Pi Exec explicitly excludes `schedule` and `task` from extension-tool capture.

Validation:

- Changed-file Biome format check passed.
- `npm run lint` passed.
- `npm run typecheck` passed.
- `npm test` passed: 93 Vitest files / 1,055 tests, 121 pair-harness tests, and the package loader.
- `npm run pack:check` passed; the tarball includes `components/tasks/src/schedule-tool.ts` and `docs/scheduling.md` and excludes removed reminder files.
- `git diff --check` passed.
- `graphify update .` completed.
- The repository-wide `npm run format:check` remains blocked by pre-existing generated `components/graphify-out/cache/**` JSON formatting; changed source and documentation files pass Biome directly.

## Outcome

`remind_me` was replaced by root-only `schedule({ delay_seconds, prompt? | command? })`. Zero-delay prompts batch until the active run settles; delayed commands start without an inference turn and use existing completion wake-ups. `task` now lists, inspects, waits for, and cancels all managed work through `list`, `status`, and `cancel`. Scheduling remains one-shot, relative, in memory, and lifecycle-cleaned.

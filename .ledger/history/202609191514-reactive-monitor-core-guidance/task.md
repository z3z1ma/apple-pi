Status: done
Created: 2026-09-19
Updated: 2026-09-19

# Add reactive monitor and consolidate native capability guidance

## Intent

Add a root-session `monitor` tool as the reactive counterpart to background `bash`: it starts a raw shell command immediately, treats each newline-terminated stdout line as a meaningful event, and steers the agent at Pi's next safe model boundary while the command continues under the existing managed-task lifecycle.

Consolidate native harness education into concise core tool guidance. The model should learn the execution vocabulary (`bash`, `schedule`, `monitor`, `task`) and ordinary Pi Exec use from the always-present tool contract; packaged skills remain procedures rather than prerequisite native-capability manuals.

## Acceptance Criteria

- `monitor({ command, max_events? })` starts an unmodified root-session command and returns a normal `task-*` ID.
- Every completed stdout line dispatches one visible `apple-pi.monitor-event` message with `deliverAs: "steer"` and `triggerTurn: true`; completed lines are not coalesced or held until settlement. Stderr and unterminated stdout fragments remain task output rather than events.
- `max_events`, when supplied, is a positive integer chosen by the caller. Its final delivered event announces that the process will continue silently until completion; omitting it leaves event delivery open-ended.
- Monitor completion/failure still uses the existing managed-task follow-up notification. `task` lists, inspects, waits for, and cancels monitor tasks through the shared lifecycle and complete rolling output.
- Monitor commands bypass RTK because stdout is their event protocol. Session transitions and shutdown terminate them with all other managed tasks.
- `monitor`, `schedule`, and `task` remain unavailable through Pi Exec captured extension tools.
- Core tool guidance concisely teaches when to use `bash`, `schedule`, `monitor`, and `task`, plus how to author line-oriented event adapters with filtered, line-buffered stdout.
- Pi Exec's live tool description/schema retains its native selection and authoring contract without directing the model to load a `pi-exec` skill. The redundant packaged skill and its active references are removed.
- README, product docs, maintainer guidance, package-loader expectations, terse rendering, and relevant behavior tests match the new surface.
- The repository's normal validation sequence passes, and Graphify is updated after code changes.

## Current State

Implemented and validated. The root session now exposes `monitor`, its event stream shares the managed-command lifecycle, and Pi Exec excludes it alongside `schedule` and `task`. Native execution guidance is carried by core tool metadata, while the redundant `pi-exec` skill is removed.

## Outcome

Added immediate line-oriented monitor steering with optional caller-owned event limits, preserved reliable completion follow-ups and task inspection/cancellation, consolidated execution guidance, and excluded `graphify-out` from Biome formatting. `npm run check`, `npm test`, `npm run pack:check`, `git diff --check`, and `graphify update .` pass.

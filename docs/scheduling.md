# One-shot scheduling

`schedule` arranges one self-authored prompt or bash command for later in the current root session. It is a session-local continuation primitive, not a persistent task system or cron service.

## Prompts

```json
{
  "delay_seconds": 600,
  "prompt": "Check whether the CI run finished and continue if appropriate."
}
```

When its delay ends, a prompt is sent at once as a visible steering message: during an active run it arrives at the next safe turn boundary, and while idle it starts a turn. The injected message identifies it as the model's own deferred prompt rather than new operator authority and requires reassessment against current direction and repository state.

## Commands

```json
{
  "delay_seconds": 300,
  "command": "gh run watch --exit-status"
}
```

A due command starts without an inference turn. Its managed task moves from `scheduled` to `running`; completion, failure, cancellation, or external termination sends the same steering notification used by an immediately backgrounded bash command. Use `bash` with `run_in_background: true` when a command should start immediately.

Every schedule returns a `task-*` ID and resolved due time. Use `task` to list, inspect, wait for, or cancel it.

## Boundaries

Scheduling is root-only, one-shot, relative, and in memory. `delay_seconds` is limited to the platform timer range (about 24.8 days). Session start, fork, tree navigation, switch, and shutdown discard scheduled work without notifications. It does not survive Pi exit or execute while the owning session is closed. There are no absolute dates, recurrence, cron expressions, arbitrary delayed tool calls, ambient reminders, or persistent scheduler state.

`schedule`, `monitor`, and `task` are intentionally unavailable inside `pi_exec`; programs already have bounded timers and direct `pi.bash`, while root-session wake-up, steering, and managed-task ownership remain outside the guest runtime.

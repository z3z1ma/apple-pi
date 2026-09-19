# One-shot scheduling

`schedule` arranges one self-authored prompt or bash command for later in the current root session. It is a session-local continuation primitive, not a persistent task system or cron service.

## Prompts

```json
{
  "delay_seconds": 0,
  "prompt": "Inspect the focused test result and continue if appropriate."
}
```

A zero-delay prompt becomes due immediately but waits for the active agent run to settle before delivery. Positive delays wake an idle agent when due or queue behind the active run. Prompts that become due together are delivered in one visible follow-up. The injected message identifies them as the model's own deferred prompts rather than new operator authority and requires reassessment against current direction and repository state.

## Commands

```json
{
  "delay_seconds": 300,
  "command": "gh run watch --exit-status"
}
```

A due command starts without an inference turn. Its managed task moves from `scheduled` to `running`; completion or failure sends the same reactive wake-up used by an immediately backgrounded bash command. Use `bash` with `run_in_background: true` when a command should start immediately.

Every schedule returns a `task-*` ID and resolved due time. Use `task` to list, inspect, wait for, or cancel it.

## Boundaries

Scheduling is root-only, one-shot, relative, and in memory. Scheduled work is cancelled on session start, fork, tree navigation, switch, and shutdown. It does not survive Pi exit or execute while the owning session is closed. There are no absolute dates, recurrence, cron expressions, arbitrary delayed tool calls, ambient reminders, or persistent scheduler state.

`schedule` and `task` are intentionally unavailable inside `pi_exec`; programs already have bounded timers and direct `pi.bash`, while root-session wake-up and managed-task ownership remain outside the guest runtime.

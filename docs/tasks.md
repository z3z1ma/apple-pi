# Managed tasks and reactive wake-up

The tasks extension owns immediate background commands, one-shot schedules, task inspection and cancellation, and root-session wake-up when deferred work becomes actionable.

## Capabilities

1. **Human-initiated backgrounding (`Ctrl+B`)**: While a foreground command executes, the operator can press `Ctrl+B` to detach it. The `bash` call returns partial output and a task ID while the process continues.
2. **Agent-initiated backgrounding (`run_in_background: true`)**: `bash` starts a command immediately, returns its task ID, and lets the agent continue without blocking.
3. **One-shot scheduling (`schedule`)**: A prompt or command becomes due after a relative delay. Prompts wake the agent; commands start silently and wake it on completion or failure.
4. **Reactive wake-up**: Completion and due-prompt messages use `deliverAs: "followUp"` with `triggerTurn: true`. An idle agent wakes immediately; an active run receives the follow-up after it settles.
5. **Task management (`task`)**: All scheduled prompts, scheduled commands, and immediate background commands share `task-*` IDs and one inspection/cancellation surface.

## Tools

### `bash` (extended)

```json
{
  "command": "npm test",
  "timeout": 60,
  "stdin": "optional text piped to process standard input",
  "run_in_background": true,
  "verbatim": false
}
```

- `stdin`: Optional process standard input.
- `run_in_background`: Start immediately and return a managed task descriptor.
- `verbatim`: Bypass RTK command rewriting when exact raw execution is required.

### `schedule`

Schedule exactly one prompt or command:

```json
{
  "delay_seconds": 0,
  "prompt": "Continue after the active run settles."
}
```

```json
{
  "delay_seconds": 120,
  "command": "gh run watch --exit-status"
}
```

`delay_seconds` must be a finite non-negative number. A zero-delay prompt preserves next-turn continuation. A scheduled command uses the working directory and shell environment captured when it is created.

### `task`

```json
{
  "action": "list" | "status" | "cancel",
  "task_id": "task-1",
  "wait_seconds": 10
}
```

- `list`: Show managed tasks, kinds, states, due times, process IDs, and summaries.
- `status`: Show prompt details or command output. `wait_seconds` optionally waits for active work to settle.
- `cancel`: Cancel a scheduled prompt or command, or terminate a running command and its process tree.

Prompt states are `scheduled`, `due`, `delivered`, or `cancelled`. Command states are `scheduled`, `running`, `completed`, `failed`, or `cancelled`.

## Command notification format

When a command finishes, an `apple-pi.task-notification` message is appended to the transcript:

```xml
<task-notification id="task-1" status="completed">
Task task-1 (completed) finished in 14.2s with exit code 0.
Command: npm run build

Output:
...
</task-notification>
```

## Lifecycle and safety

- **Root session only**: Child sessions and subagents do not load the extension.
- **Session local**: Schedules are one-shot and in memory. Session start, fork, tree navigation, switch, and shutdown cancel active work.
- **Process cleanup**: Cancellation terminates the complete process tree and removes temporary output files during lifecycle cleanup.
- **Memory bounded**: Command output keeps a rolling tail. Full truncated output streams to a temporary file.
- **Pi Exec isolation**: `schedule` and `task` are excluded from captured extension tools. Pi Exec's `pi.bash` remains direct and has no background-task or scheduling parameters.

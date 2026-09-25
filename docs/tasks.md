# Managed tasks and reactive execution

The tasks extension owns immediate background commands, command monitors, one-shot schedules, task inspection and cancellation, and root-session wake-up when managed work becomes actionable.

## Execution model

Choose the entrypoint by intent:

1. **`bash`** runs work now. `run_in_background: true` is for finite or quiet work that should wake the agent only when it completes or fails.
2. **`schedule`** arranges one prompt or command to start after a relative delay.
3. **`monitor`** starts a continuing shell event source now. Every newline-terminated stdout line immediately steers the agent while the command keeps running.
4. **`task`** lists, inspects, waits for, or cancels any managed command, monitor, or schedule.

All command forms share the same `TaskManager`, `task-*` IDs, rolling output, process-tree cancellation, completion notification, and session lifecycle. A monitor is a managed command with stdout event delivery, not a second task system.

## Interactive visibility and management

Scheduled, due, and running tasks join public subagents in one width-bounded active-work widget above the editor. Prompt, command, and monitor rows show their kind and current timing; monitor rows also show delivered events and whether delivery is active or silent. The editor metadata shows `tasks:N` only while active tasks exist. Terminal tasks leave these passive surfaces because their delivered prompts and transcript notifications remain the outcome record.

`/work` or `Ctrl+W` opens one active-work manager with Agents and Tasks tabs; `/tasks` remains an alias that opens the Tasks tab. `Ctrl+W` intentionally replaces Pi's default delete-word-backward editor shortcut. Use `Tab`/`Shift+Tab` or left/right to switch tabs. The session-local task roster orders active work before settled outcomes and uses the configured selection keys: select a row and press `Enter` to inspect it, or use `Esc`/`q` to close. Task detail shows:

- complete prompt text, creation/due timing, and delivery state;
- command text, working directory, timing, PID, exit state, and a live rolling output tail;
- monitor event delivery count, caller-owned limit, and active/silent/finished delivery state;
- an explicit truncation notice and full-output path when the rolling output is incomplete.

Use `x` twice in detail to confirm cancellation of scheduled, due, or running work. Settled tasks remain readable and offer no cancellation action. Detail scrolling follows the configured selection and page keys; `Home` and `End` move to the start or live tail.

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
- `run_in_background`: Start immediately and return a managed task descriptor. Completion, failure, cancellation, or process termination sends an XML task notification through `deliverAs: "steer"` so the main agent sees the terminal transition.
- `verbatim`: Bypass RTK command rewriting when exact raw execution is required.
- While a foreground command executes, the operator can press `Ctrl+B` to detach it into the same managed-task lifecycle.

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

`delay_seconds` must be a finite non-negative number. A zero-delay prompt preserves next-turn continuation. Due prompts use `deliverAs: "steer"`: they enter an active run at its next safe turn boundary or start a turn while idle. A scheduled command uses the working directory and shell environment captured when it is created.

### `monitor`

```json
{
  "command": "tail -F app.log | awk '/ERROR/ { print; fflush() }'",
  "max_events": 5
}
```

`monitor` runs the command verbatim because stdout is its event protocol. Every newline-terminated stdout line creates one visible `apple-pi.monitor-event` message with `deliverAs: "steer"` and `triggerTurn: true`:

- during an active run, Pi delivers the event after the current assistant turn finishes its tool calls and before the next model call;
- while idle, the event starts a model turn;
- completed lines are delivered individually rather than coalesced or deferred until settlement;
- stderr and unterminated stdout fragments remain recorded task output and do not create events.

Write monitor commands as event adapters. Emit only meaningful state changes on stdout, redirect or suppress diagnostic noise, and use line-buffered or unbuffered producers. Useful adapters include `awk` with `fflush()`, `jq --unbuffered`, and programs that explicitly flush after each event.

`max_events` is an optional positive integer chosen for the workflow. The last permitted event says that delivery is now silent; the process itself keeps running, all output remains available through `task status`, and every terminal outcome still sends the normal steer notification. Omit `max_events` when an open-ended event stream is appropriate.

### `task`

```json
{
  "action": "list" | "status" | "cancel",
  "task_id": "task-1",
  "wait_seconds": 10
}
```

- `list`: Show managed tasks, kinds, states, due times, process IDs, and summaries. Monitors are labeled `monitor`.
- `status`: Show prompt details or command output. Monitor status also reports delivered events and whether event delivery is active or silent. `wait_seconds` optionally waits for active work to settle. Press `Esc` to interrupt the wait without cancelling the task.
- `cancel`: Cancel a scheduled prompt or command, or terminate a running background command or monitor and its process tree.

Prompt states are `scheduled`, `due`, `delivered`, or `cancelled`. Command and monitor states are `scheduled`, `running`, `completed`, `failed`, or `cancelled`.

## Message formats

A monitor line is appended to the transcript as:

```xml
<monitor-event id="task-1" event="2" max-events="5">
ERROR connection pool exhausted
</monitor-event>
```

The final limited event includes the silent-until-completion notice inside the same message.

Every command or monitor terminal outcome—completion, failure, cancellation, or external termination—steers one `apple-pi.task-notification` message into the main agent. Cancelling a scheduled prompt sends the same message shape with its prompt text. Successfully delivered prompts are already the steering message and do not emit a duplicate terminal notification:

```xml
<task-notification id="task-1" status="completed">
Monitor task-1 (completed) finished in 14.2s with exit code 0.
Command: tail -F app.log | awk '/ERROR/ { print; fflush() }'

Output:
...
</task-notification>
```

## Lifecycle and safety

- **Root session only**: Child sessions and subagents do not load the extension.
- **Session local**: Schedules and monitors are in memory. Session start, fork, tree navigation, switch, and shutdown cancel active work and clear the prior session's task roster.
- **Process cleanup**: Cancellation terminates the complete process tree and removes temporary output files during lifecycle cleanup.
- **Memory bounded**: Command output keeps a rolling tail. Full truncated output streams to a temporary file.
- **Pi Exec isolation**: `schedule`, `monitor`, and `task` are excluded from captured extension tools. Pi Exec's `pi.bash` remains direct, verbatim, and without background, scheduling, or monitoring parameters.

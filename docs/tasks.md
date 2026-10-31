# Managed tasks and reactive execution

The tasks extension owns immediate background commands, command monitors, one-shot schedules, task inspection and cancellation, and root-session wake-up when managed work becomes actionable.

## Execution model

Choose the entrypoint by intent:

1. **`bash`** runs work now. `run_in_background: true` is for finite or quiet work that should wake the agent only when it completes or fails.
2. **`remind_me`** arranges one prompt or command to start after a relative delay.
3. **`monitor`** starts a continuing shell event source now. Every newline-terminated stdout line immediately steers the agent while the command keeps running.
4. **`task`** lists, inspects, waits for, or cancels any managed command, monitor, or reminder.

All command forms share the same `TaskManager`, `task-*` IDs, rolling output, process-tree cancellation, completion notification, and session lifecycle. A monitor is a managed command with stdout event delivery, not a second task system.

## Interactive visibility and management

Scheduled, due, and running tasks join running [Pi Exec programs](exec.md) and [intern](interns.md) calls in one width-bounded active-work widget above the editor. Prompt, command, and monitor rows show their kind and current timing; monitor rows also show delivered events and whether delivery is active or silent. The editor metadata shows `tasks:N` only while active tasks exist. Terminal tasks leave these passive surfaces because their delivered prompts and transcript notifications remain the outcome record.

Inspect the roster and later output with the `task` tool. Its `status` action retains prompt/command details, timing, exit state, monitor delivery state, truncation notices and full-output paths; `cancel` stops owned work and reports its terminal outcome. The transcript and tool inspector retain returned results.

The combined `/work` and `/tasks` panel is retired. `/reviews` and `Ctrl+W` now belong to the [captured review queue](code-review.md#review-queue-tui); task execution, reminders, monitoring and passive activity remain independent.

## Tools

### `bash` (extended)

```json
{
  "command": "npm test",
  "timeout": 60,
  "stdin": "optional text piped to process standard input",
  "run_in_background": true,
  "verbatim": false,
  "expect": "success"
}
```

- `stdin`: Optional process standard input.
- `run_in_background`: Start immediately and return a managed task descriptor. Completion, failure, cancellation, or process termination sends an XML task notification through `deliverAs: "steer"` so the main agent sees the terminal transition.
- `verbatim`: Bypass RTK command rewriting when exact raw execution is required.
- `expect`: The exit status the agent predicts for a foreground command, `success` (exit 0) or `failure`. When the prediction misses, the result ends with a `Surprise:` line. The prediction is recorded before the result, so it cannot be rewritten afterwards. A predicted failure, such as a red test, is not evidence for the learning reflection; a success that was predicted to fail is. Background commands ignore it.
- While a foreground command executes, the operator can press `Ctrl+B` to detach it into the same managed-task lifecycle.

#### Terminal

Foreground, background, and scheduled commands, and the operator's own `!` commands, write stdout and stderr to one pseudo-terminal, so programs behave as in the operator's terminal: `git`, `bat`, `rg`, and test runners emit their usual colors and layout, and stdout and stderr keep their order. Programs that never color (`sed`, `cat`, `head`) and commands piped into another stay plain, as they do in a terminal.

- The terminal is as wide as Pi's terminal less the transcript indent (80 by 24 without a terminal). `TERM`, `COLUMNS`, and `LINES` describe it.
- `ls`, `grep`, and `diff` default to no color; interactive shells such as fish wrap them with `--color=auto`. Bash loads the same wrappers for each command's own shell through `BASH_ENV` (each only when the installed program accepts the option). Nested bash scripts get the operator's own `BASH_ENV` back, without the wrappers.
- Stdin stays a pipe (the `stdin` text, or empty), and the command has no controlling terminal: a program that asks for a password on `/dev/tty`, such as `sudo` or `ssh`, fails at once instead of waiting. `PAGER` and `GIT_PAGER` are `cat`, because a pager would wait for keys.
- Output is read as a terminal shows it: carriage returns, erasures, and cursor movement redraw lines in place, so a progress bar leaves its final state rather than every frame. Full-screen (alternate screen) output is dropped, other control sequences are removed, and colors are kept.
- The model receives plain text. The transcript and the tool inspector show the colors, which the result carries in `details.styledOutput`. Truncation and the full-output file count plain text.
- A failed or timed-out command returns an error result with its output, rather than a thrown error.
- A process left running in the background (`server &`) keeps the terminal open; the command still finishes once its shell exits and the output falls quiet.
- `!` and `!!` commands get the same terminal, without RTK. Their live TUI output keeps colors through a display-only patch; Pi records each line's final plain text, so model context and output files remain plain. Colors are held by the UI component only; resuming a session shows the recorded plain output.
- When no pseudo-terminal can be opened (Windows, a platform without the prebuilt `@lydell/node-pty` binary, or none free), the command runs on pipes as before and `details.terminalUnavailable` says why.
- `monitor` and Pi Exec's `pi.bash` keep pipes: programs read their output. Their text also reaches the model without colors.
- With [RTK](rtk.md) enabled (`RTK_ENABLED=1`), RTK rewrites some commands (for example `git status`) into its own compact output, which has no colors; `verbatim: true` runs the original command.

### `remind_me`

Arrange exactly one prompt or command:

```json
{
  "delay_seconds": 300,
  "text": "Check whether the deployment finished."
}
```

```json
{
  "delay_seconds": 120,
  "command": "gh run watch --exit-status"
}
```

`delay_seconds` must be a finite non-negative number. `delay_seconds` is also limited to the platform timer range (about 24.8 days). When its delay ends, a prompt steers at once with `deliverAs: "steer"`: it enters an active run at its next safe turn boundary or starts a turn while idle. A scheduled command uses the working directory and shell environment captured when it is created.

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

- **Top-level sessions only**: [Interns](interns.md) and the [`/btw`](btw.md) session do not load the extension.
- **Session local**: Reminders and monitors are in memory. Session start, fork, tree navigation, switch, and shutdown stop active work and clear the prior session's task roster without terminal notifications.
- **Process cleanup**: Cancellation terminates the complete process tree and removes temporary output files during lifecycle cleanup.
- **Memory bounded**: Command output keeps a rolling tail. Full truncated output streams to a temporary file.
- **Pi Exec isolation**: `remind_me`, `monitor`, and `task` are excluded from captured extension tools. Programs may call `send_mail` and `reply` ([mail](session-state.md#mail-and-threads)), because it wakes another session, not this one. Pi Exec's `pi.bash` remains direct, verbatim, and without background, scheduling, or monitoring parameters.

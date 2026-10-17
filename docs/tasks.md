# Managed tasks and reactive execution

The tasks extension owns immediate background commands, command monitors, one-shot schedules, task inspection and cancellation, the session mailbox, and root-session wake-up when managed work becomes actionable.

## Execution model

Choose the entrypoint by intent:

1. **`bash`** runs work now. `run_in_background: true` is for finite or quiet work that should wake the agent only when it completes or fails.
2. **`schedule`** arranges one prompt or command to start after a relative delay.
3. **`monitor`** starts a continuing shell event source now. Every newline-terminated stdout line immediately steers the agent while the command keeps running.
4. **`task`** lists, inspects, waits for, or cancels any managed command, monitor, or schedule.
5. **`mailbox_send`** sends a message to another Pi session; see [Session mailbox](#session-mailbox).

All command forms share the same `TaskManager`, `task-*` IDs, rolling output, process-tree cancellation, completion notification, and session lifecycle. A monitor is a managed command with stdout event delivery, not a second task system.

## Interactive visibility and management

Scheduled, due, and running tasks join public subagents in one width-bounded active-work widget above the editor. Prompt, command, and monitor rows show their kind and current timing; monitor rows also show delivered events and whether delivery is active or silent. The editor metadata shows `tasks:N` only while active tasks exist. Terminal tasks leave these passive surfaces because their delivered prompts and transcript notifications remain the outcome record.

`/tasks` opens the shared [work panel](subagents.md#work-panel) directly on its Tasks tab; `/work` opens it on its last-used tab. `Ctrl+W` toggles it closed or reopens it on that tab. `Ctrl+W` intentionally replaces Pi's default delete-word-backward editor shortcut. The panel's placement, focus, tab, and close keys are described there. The Tasks tab lists the session-local task roster, active work before settled outcomes, and shows the selected task's detail below the list. Use `Tab`/`Shift+Tab` to select a task. Task detail shows:

- complete prompt text, creation/due timing, and delivery state;
- command text, working directory, timing, PID, exit state, and a live rolling output tail;
- monitor event delivery count, caller-owned limit, and active/silent/finished delivery state;
- an explicit truncation notice and full-output path when the rolling output is incomplete.

Use `x` twice to confirm cancellation of the selected scheduled, due, or running task; the confirmation is dropped when focus leaves the panel, the tab changes, or another task is selected. Settled tasks remain readable and offer no cancellation action. Detail scrolling follows the configured selection and page keys and the mouse wheel; `Home` and `End` move to the start or live tail. Selecting a task again, or reopening the panel, returns its detail to where you left it; if it was following the live tail, it keeps following new output. This restored state lives in memory for the Pi process only and is never written to the session, so a restart starts fresh. Task detail positions clear with the task roster at session start, switch, fork, tree navigation, and shutdown.

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

### `schedule`

Schedule exactly one prompt or command:

```json
{
  "delay_seconds": 300,
  "prompt": "Check whether the deployment finished."
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

## Session mailbox

Every root Pi session has a durable mailbox. Another session, a headless `pi -p` run, a shell script, or a clock can send it a message, and the session receives the message as a steer: at the next safe boundary during a run, as a new turn while idle, or in the first run after the session next opens.

### Addressing

A mailbox belongs to a session id. For a stable address, start the session with a fixed id: `pi --session-id orchard` reopens the same session, and so the same mailbox, every time. `/fork` and `/clone` create a new session id with a new, empty mailbox; `/tree` keeps the id. Mailboxes are shared across projects: Pi's default session ids are UUIDs, so give a named id such as `orchard` to one project only. Run one process per session id: Pi does not stop two processes from opening the same session, and both would act on the same messages.

### Sending

Agents call `mailbox_send`:

```json
{
  "session_id": "orchard",
  "message": "Worker w-7f3a is blocked on a review."
}
```

`from` is set to the sender's session id, so the receiver can answer with `mailbox_send` to that id. Anything outside Pi uses the packaged script; its path is in the `mailbox_send` tool guidance:

```bash
node components/tasks/scripts/pi-send.mjs orchard --from launchd "Tick."
echo "Nightly sweep finished." | node components/tasks/scripts/pi-send.mjs orchard
```

Both append one JSON line to `~/.pi/agent/state/mailbox/<session-id>.jsonl` (override the directory with `PI_MAILBOX_DIR`):

```json
{"id":"…","from":"launchd","ts":"2026-10-16T12:00:00.000Z","body":"Tick."}
```

Senders only append, so several can write at once without a lock. The session id must match Pi's own rule (letters, digits, `.`, `_`, `-`).

### Delivery

The session itself records what was delivered. Each delivery is a steer whose `custom_message` entry carries the message in `details`. On session start, when the mailbox file changes, and when a run completes, the session delivers every complete, well-formed line whose `id` is not yet recorded on any branch of the session and not already queued. The file watcher only wakes the reader; a dropped notification is picked up when the next run completes.

When Pi itself starts, waiting mail rides the first run instead of starting one, because the command may carry its own prompt (`pi -p "..."`, `pi --session-id w-7f3a "brief"`) and Pi rejects a prompt while a turn is running. That prompt, your first message, or the next mailbox message starts the run that carries it. `/new`, `/resume`, `/fork`, and `/reload` deliver at once.

If you press Escape while a message is queued, Pi discards the queue; the message is delivered again after your next completed run, not immediately, so the cancelled work does not restart.

Delivery is at least once. A crash after a message is queued but before Pi records it delivers that message again on the next open; the `id` identifies the repeat. A message recorded on a branch that `/tree` left is not delivered again. Messages to a session that is not running wait in its mailbox; nothing expires or removes them. When no running Pi session in tmux publishes the receiver's id (see [tmux sessions](tmux-sessions.md#the-state-contract)), `mailbox_send` says so in its result, so the sender knows the message waits; a receiver outside tmux gets the same note.

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
- **Session local**: Schedules and monitors are in memory. Session start, fork, tree navigation, switch, and shutdown stop active work and clear the prior session's task roster without terminal notifications. The session mailbox is the one persistent piece: its messages live on disk and survive Pi exit.
- **Process cleanup**: Cancellation terminates the complete process tree and removes temporary output files during lifecycle cleanup.
- **Memory bounded**: Command output keeps a rolling tail. Full truncated output streams to a temporary file.
- **Pi Exec isolation**: `schedule`, `monitor`, and `task` are excluded from captured extension tools; programs may call `mailbox_send`, because it wakes another session, not this one. Pi Exec's `pi.bash` remains direct, verbatim, and without background, scheduling, or monitoring parameters.

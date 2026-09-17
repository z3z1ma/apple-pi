# Task backgrounding and reactive wake-up

The tasks extension provides process backgrounding with reactive wake-up for shell commands in `apple-pi`.

## Capabilities

1. **Human-initiated backgrounding (`Ctrl+B`)**:
   While a foreground command executes in the terminal, the operator can press `Ctrl+B` to background it. The foreground `bash` tool call returns early with the accumulated partial output and task ID. The process continues running detached in the background.

2. **Agent-initiated backgrounding (`run_in_background: true`)**:
   The agent can execute commands with `run_in_background: true` on the `bash` tool. The tool returns immediately with the task ID and initial status, letting the agent continue working without blocking.

3. **Reactive wake-up**:
   When any background task completes (code 0) or fails (non-zero code or error), a high-priority follow-up notification is dispatched to the session (`triggerTurn: true`). If the agent is idle, it wakes up immediately to process the result; if the agent is actively executing a turn, the notification queues as a follow-up for the next turn.

4. **Task management (`task` tool)**:
   The agent can manage background tasks at any time using the `task` tool:
   - `list`: Shows all background tasks, status, PID, duration, exit code, and command.
   - `status`: Shows detailed status and recent output for a specific `task_id`. Accepts optional `wait_seconds` to pause and wait for completion.
   - `kill`: Terminates a background task and its entire child process tree.

## Tools

### `bash` (extended)

The standard `bash` tool is extended with backgrounding and standard input support:

```json
{
  "command": "npm run test",
  "timeout": 60,
  "stdin": "optional text piped to process standard input",
  "run_in_background": true,
  "verbatim": false
}
```

- `stdin` (optional string): Text piped into the process's standard input stream.
- `run_in_background` (optional boolean): When `true`, detaches the command immediately and returns a task descriptor (`task-1`).
- `verbatim` (optional boolean): When `true`, executes the command without RTK output compression when exact raw output is required.

### `task`

```json
{
  "action": "list" | "status" | "kill",
  "task_id": "task-1",
  "wait_seconds": 10
}
```

- `action`:
  - `"list"`: Formatted table of all background tasks in the session.
  - `"status"`: Full metadata and output preview for `task_id`.
  - `"kill"`: Terminate the task process tree.
- `task_id` (string, required for `status` and `kill`): The task identifier.
- `wait_seconds` (number, optional): Maximum seconds to wait for a running task to complete when querying `status`.

## Notification format

When a task finishes, a custom message (`apple-pi.task-notification`) is appended to the transcript:

```xml
<task-notification id="task-1" status="completed">
Task task-1 (completed) finished in 14.2s with exit code 0.
Command: npm run build

Output:
...
</task-notification>
```

In interactive TUI sessions, this renders as a compact card:

```text
✓ Background Task task-1 (completed, 14.2s, exit 0)
  $ npm run build
  ⎿  Build completed successfully in 12.8s
```

## Lifecycle and safety

- **Root session only**: Background tasks run exclusively in root sessions. Child sessions and subagents do not load the extension.
- **Process cleanup**: When the session shuts down or switches (`session_shutdown`, `session_before_switch`), all active background tasks are killed and temporary output files are deleted.
- **Memory bounded**: Task output maintains a rolling buffer in memory. If output exceeds standard limits (2000 lines or 50KB), full output streams to a temporary log file while preserving the tail in memory.

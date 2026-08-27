# BTW side conversation

`/btw` opens a private, read-only side conversation without adding its turns to the main agent's context.

## Usage

```text
/btw Why does this function return undefined?
/btw
```

- `/btw <question>` starts the side conversation or opens it with a new question.
- `/btw` reopens the conversation. On first use it prompts for the opening question.
- Press `Enter` inside the overlay to ask follow-up questions.
- Press `i` or `Option-I` (`Alt+I`) to inject the latest completed answer into the main conversation.
- Press `Option-X` (`Alt+X`) to clear the side conversation, or `x` twice to stop only the active response.
- Press `Esc` or `q` to close the overlay. The side agent keeps working.

If the main agent is busy, injection is delivered as a follow-up after its current work settles rather than steering or interrupting it. Injection does not clear BTW, so the side conversation can continue.

The conversation uses the model and thinking level that were active when it started. It has only `read`, `grep`, `find`, and `ls`; it cannot change files or call apple-pi's task, memory, MCP, exec, or delegation tools. It loads neither the Sentinel nor observational memory.

## Context and caching

Context is captured per overlay visit:

1. The first question receives up to 12,000 characters of recent parent user/assistant text and the latest applicable compaction summary.
2. Follow-ups asked while that overlay remains open use the same snapshot.
3. After the overlay is closed and reopened, the next question appends only new parent conversation text since the previous snapshot.

Tool results and extension state are excluded. Explicit BTW injection messages are also excluded from later snapshots. The child conversation itself is append-only: prior prompts are never rewritten when parent context is refreshed. This keeps the provider-cache prefix stable while making a reopened BTW conversation current with the main thread.

BTW state is intentionally session-local and in-memory. Clearing, switching, forking, navigating the parent conversation tree, reloading, or ending the parent session stops and discards it.

## Design boundary

BTW reuses apple-pi's owned child-session manager, model routing, cancellation, and usage accounting with a dedicated answer-first Markdown overlay. It does not add another RPC protocol, process manager, settings file, history store, slot system, fallback model path, or logging subsystem.

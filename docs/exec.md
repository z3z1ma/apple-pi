# Pi Exec

`pi_exec` runs a type-checked Python snippet inside a Monty worker subprocess. Intermediate tool output stays inside the snippet; only its last expression (and captured `print` output) enters the main conversation. It is available only in the root Pi session.

## Core tool surface

The `code` parameter lists the live signatures generated from Pi's core tool schemas. The **same signatures** are passed to Monty's checker before execution, so a wrong keyword argument is reported before any tool call starts. Use keyword arguments and `await`:

```python
import asyncio
paths = ["README.md", "docs/exec.md"]
texts = await asyncio.gather(*[read(path=path) for path in paths])
{path: len(text) for path, text in zip(paths, texts)}
```

The current guest provides `read`, `grep`, `find`, `ls`, `bash`, `edit`, and `write`. The last expression is the result; there is no top-level `return`. It supports Monty's Python subset, including ordinary loops, comprehensions, and `asyncio.gather`, but not third-party imports, `create_task`, or an ambient Node or OS API. `bash`, `edit`, and `write` return `{ "ok": bool, "output": str }`; the read/search tools return text. Core tool calls still pass through the search-root guard and the host tool definitions.

`inputs` is a dictionary of caller-provided strings. `state` is a mutable JSON dictionary restored with an explicit state ID; it will be replaced by branch-aligned live sessions in a later ticket. `display` and `limits` are tool parameters, not Python globals. `print` is captured with a bounded output collector.

The program result must be JSON-compatible. Python dicts with string keys and lists convert to JSON objects and arrays. Sets, bytes, non-finite numbers, cycles, and dicts with non-string keys fail at the boundary. Monty can stringify functions and cyclic references on export; the boundary rejects its function-repr and cycle-placeholder strings. Literal strings of the same form are also rejected because Monty does not distinguish them after export.

## Limits and execution

`limits` can adjust call budget, concurrency, agent budget, and timeout within package maxima. The host queues gathered calls above the concurrency limit. Monty enforces memory, feed/turn execution time, recursion, and a suspension budget derived from the host call budget. The host separately enforces the wall deadline because execution-time limits do not run while waiting for a host tool. On cancellation, pending host calls are rejected and new calls are refused; a worker that reaches a terminal resource limit is discarded.

Each tool call has a durable trace and live TUI activity. Error results retain the trace through Pi's `tool_result` hook. In a TUI, the card shows a bounded Python preview, active calls, and elapsed time.

## Staged surface

Model workers, captured extension tools and MCP, HTTP fetch, the evidence library, saved Python programs, and branch-aligned Monty session persistence are separate tickets in the governing ledger bundle. Until those tickets land, the runtime **does not advertise** saved JavaScript programs as executable tools. The old JavaScript guest and its web polyfills are gone; there is no fallback runtime.

See [subagents](subagents.md) for the interactive `agent` tool and [boundaries](boundaries.md) for the adopted integration boundary.

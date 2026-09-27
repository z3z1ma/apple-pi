# Pi Exec

`pi_exec` runs a type-checked Python snippet inside a Monty worker subprocess. Intermediate tool output stays inside the snippet; only its last expression (and captured `print` output) enters the main conversation. It is available only in the root Pi session.

## Core tool surface

The `code` parameter lists live signatures generated from Pi's core and captured extension tool schemas. The **same signatures** are passed to Monty's checker before execution, so a wrong keyword argument is reported before any tool call starts. Use keyword arguments and `await`:

```python
import asyncio
paths = ["README.md", "docs/exec.md"]
texts = await asyncio.gather(*[read(path=path) for path in paths])
{path: len(text) for path, text in zip(paths, texts)}
```

The current guest provides `read`, `grep`, `find`, `ls`, `bash`, `edit`, and `write`. The last expression is the result; there is no top-level `return`. It supports Monty's Python subset, including ordinary loops, comprehensions, and `asyncio.gather`, but not third-party imports, `create_task`, or an ambient Node or OS API. `bash`, `edit`, and `write` return `{ "ok": bool, "output": str }`; the read/search tools return text. Core tool calls still pass through the search-root guard and the host tool definitions.

`inputs` is a dictionary of caller-provided strings. Python globals and functions persist across calls on the current Pi session branch. Annotate a global with a broad type, such as `count: int = 1`, if later feeds will assign other values; Monty otherwise infers the initial literal type. Pass `reset: true` to start a fresh interpreter before a call. `display`, `reset`, and `limits` are tool parameters, not Python globals. `print` is captured with a bounded output collector.

The program result must be JSON-compatible. Python dicts with string keys and lists convert to JSON objects and arrays. Sets, bytes, non-finite numbers, cycles, and dicts with non-string keys fail at the boundary. Monty can stringify functions and cyclic references on export; the boundary rejects its function-repr and cycle-placeholder strings. Literal strings of the same form are also rejected because Monty does not distinguish them after export.

## Model workers and schemas

`agent_run(task=..., ...)` returns a status record rather than raising for a failed worker. `agent(task=..., ...)` returns text or the structured value from `output_schema`, and raises on failure. Worker options include `type`, `name`, `profile`, `tools`, `pair`, `system_prompt`, `context`, and `output_schema`. Context is attached to a child as a JSON file, never interpolated into the task. A strict schema can be built locally with `schema(shape)`:

```python
import asyncio
names = ["alpha", "beta", "gamma"]
rows = await asyncio.gather(*[
    agent_run(task="Inspect this path", context={"path": name},
              output_schema=schema({"risk": ["low", "high"], "evidence": "str"}))
    for name in names
])
[{"path": name, "status": row["status"], "value": row.get("value")} for name, row in zip(names, rows)]
```

Worker calls share the host call, concurrency, agent, and wall-clock budgets. Worker usage is included in the outer result, and child tool operations appear in its trace. `schema` is a pure in-sandbox function and does not consume a host call or Monty suspension. A marked `context` passed to `agent_run` is fitted automatically; the returned record's `context.truncated`, `context.dropped`, and `context.serializedChars` show the fit.

## Extensions, fetch, and skills

Each captured extension tool is callable by its registered name with schema-checked keyword arguments, for example `await mcp(tool="test_echo", args={"value": "hello"})`. Use `tools_list()`, `tools_search(query)`, `tools_describe(name)`, and `tools_call(name, args)` for dynamic discovery. The interactive subagent manager and root-only task tools remain unavailable inside Monty. The MCP gateway still owns MCP transport and authentication.

`fetch(url, method=..., headers=..., body=...)` accepts a URL, optional string headers, and a text or byte request body. It returns status, headers, URL, and a text body for textual responses or bytes for binary responses. Convert bytes before returning a JSON result. Trace summaries omit header values, request bodies, credentials, and URL queries. `skills_list()` and `skills_body(name)` expose only model-invocable skills; bodies omit frontmatter.

## Evidence helpers

`git_change`, `git_patch`, and `repo_change_neighborhood` collect scoped Git evidence. `context_required`, `context_clippable`, and `context_droppable` mark values for `context_fit` or automatic worker-context fitting; `context_pack` prioritizes selected rows under a serialized-character budget. `dev_find_relevant_tests` locates neighboring tests and `dev_run_relevant_tests` executes them with a `{tests}` command template or a package test script. These helpers are host calls and share the normal call, concurrency, trace, and cancellation budgets. Use ordinary Python sets and dictionaries for coverage and ID reconciliation; there is no separate host helper for either.

## Saved Python programs

In a trusted project, a `.pi/programs/<name>.py` file with a leading triple-quoted description and optional `@param` tags appears as `program_<name>`:

```python
"""Read the beginning of a file.
@param {str} path File to inspect
@param {int} [lines=2] Number of lines
"""
text = await read(path=inputs["path"])
"\n".join(text.splitlines()[:int(inputs["lines"])])
```

Parameters are typed tool arguments and arrive as strings in `inputs`; convert numbers explicitly. Named arguments override explicit `inputs`, which override registered defaults. Program source is re-read for each call; its registered schema and defaults change only at session start or another cache-safe boundary. Untrusted projects cannot run saved programs. JavaScript `.js` programs are not discovered.

## Limits and execution

`limits` can adjust call budget, concurrency, agent budget, and timeout within package maxima. The host queues gathered calls above the concurrency limit. Monty enforces a fixed 128 MiB memory limit, feed/turn execution time, recursion, and a session-wide suspension ceiling; the host enforces the per-call wall deadline and call budget. On cancellation, pending host calls are rejected and new calls are refused. Terminal failures discard the worker and restore the preceding checkpoint on the next call. Completed tool, file, and process effects are **not** undone by that rollback.

Each tool call has a durable trace and live TUI activity. Error results retain the trace through Pi's `tool_result` hook. In a TUI, the card shows a bounded Python preview, active calls, and elapsed time.

## Session checkpoints

Each successful feed and ordinary Python exception saves a Monty dump as a custom entry on Pi's session tree. Reload or tree navigation restores the nearest checkpoint on the selected branch. `reset: true` saves an empty checkpoint before executing its snippet, so a failed reset feed still leaves the branch reset. A damaged or incompatible checkpoint starts an empty interpreter and reports a notice; do not treat a recovered empty interpreter as restored state. Each dump is authenticated with a key in the user-global Pi agent directory before Monty loads it. A copied or altered session whose key is unavailable starts empty with a notice; session files alone do not carry the key. The old JavaScript guest, JSON state IDs, and web polyfills are gone; there is no fallback runtime.

See [subagents](subagents.md) for the interactive `agent` tool and [boundaries](boundaries.md) for the adopted integration boundary.

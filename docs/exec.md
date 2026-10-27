# Pi Exec

`pi_exec` runs a type-checked Python snippet inside a Monty worker subprocess. Intermediate tool output stays inside the snippet; only its last expression (and captured `print` output) enters the main conversation. It is available in every root Pi session for ordinary tool composition. Peer delegation and its model-facing APIs are available to roles with `manages: true` and to unroled recorded organization roots.

Use Pi Exec when a task needs tool composition or computation over tool results; use direct tools for a single operation that needs neither. Keep intermediate results in the program and return the smallest result that preserves the evidence for the next decision. Aggregate counts, select relevant excerpts, and report failures or missing evidence explicitly. Gather independent calls concurrently and await dependent steps in order. Captured `print` output also enters context, so apply the same reduction to logs.

## Core tool surface

The `code` parameter shows live signatures for core tools and host functions. It does not list extension tools, so its text stays stable as MCP servers connect; find them with `tools_list()` or `tools_search(query)`, and `tools_describe(name)` returns an extension tool's parameters. Monty's checker receives full signatures for every tool before execution, so a wrong keyword argument is reported before any tool call starts. Use keyword arguments and `await`:

```python
import asyncio
paths = ["README.md", "docs/exec.md"]
texts = await asyncio.gather(*[read(path=path) for path in paths])
{path: len(text) for path, text in zip(paths, texts)}
```

The current guest provides `read`, `grep`, `find`, `ls`, `bash`, `edit`, and `write`. The last expression is the result; there is no top-level `return`. It supports Monty's Python subset, including ordinary loops, comprehensions, and `asyncio.gather`, but not third-party imports, `create_task`, or an ambient Node or OS API. `bash`, `edit`, and `write` return `{ "ok": bool, "output": str }`; the read/search tools return text. Core tool calls still pass through the search-root guard and the host tool definitions.

`inputs` is a dictionary of caller-provided strings. Python globals and functions persist across calls on the current Pi session branch. Annotate a global with a broad type, such as `count: int = 1`, if later feeds will assign other values; Monty otherwise infers the initial literal type. Pass `reset: true` to start a fresh interpreter before a call. `display`, `reset`, `limits`, and the named `peers` attachment mapping are tool parameters. Python receives that mapping as `peers[name]` handles. `print` is captured with Monty's standard 10 MiB output collector per call. Output overflow reports `Captured print output limit exceeded`, separately from Python heap exhaustion.

The program result must be JSON-compatible. Python dicts with string keys and lists convert to JSON objects and arrays. Sets, bytes, non-finite numbers, cycles, and dicts with non-string keys fail at the boundary. Monty can stringify functions and cyclic references on export; the boundary rejects its function-repr and cycle-placeholder strings. Literal strings of the same form are also rejected because Monty does not distinguish them after export.

## Peers and schemas

Managing roles and unroled organization roots can attach colleagues or create temporary peers; nonmanagers are refused by the host before a program scope or peer is started, including from saved programs. Their tool schema and guidance omit peer APIs, attachment parameters and agent-budget controls. A nonmanaging role stays restricted even at the root, and a missing runtime record grants no root exception.

Programs use the same people as the [organization](organization.md), with catalog roles owning their models, thinking levels, and tool posture. Results come from a correlated turn in the peer's own session, not mail.

| Call | Lifetime |
| --- | --- |
| `peers["reviewer"].run(task, output_schema=...)` | Attach an awake colleague through the tool argument `peers: {"reviewer": "session-id"}`. Wait for their session to be idle, then run one turn. The person stays alive afterwards. |
| `agent(role=..., task=...)` | Create a fresh temporary colleague, assign the goal, return the reply, and discard the person before the call returns. |
| `p = await peer(role)`; `await p.run(task)`; `await p.close()` | Reuse one temporary colleague for several turns. The first turn starts the person with an assigned goal; `close()` releases it early. |

Every remaining temporary peer is discarded when the program completes, fails, or is cancelled. A temporary peer opens a tmux window in the caller's server, or an ordinary headless RPC session outside tmux. Discarding waits for its process to end and removes its person record, assignments, memberships, and private ephemeral task. Pi transcripts and shared or promoted work survive. Attached sessions are never closed; cancellation stops only the program's requested turns. Rehire a sleeping colleague before attaching, and use another colleague rather than attaching the program's own session.

Handles belong to one execution, even when their Python variables survive a checkpoint. Attach or create again on the next invocation. An unused `peer(role)` handle starts no process. Temporary peers have human names but leave routine completion alerts to the caller; requests for operator input remain visible.

`agent_run(role=..., task=...)` has the same temporary lifetime but returns a status record rather than raising on failure. A turn that stops at its output-token limit is `failed`, with its partial answer in `text`. The `changes` list records files touched through `edit` or `write`; `usage` and the operation trace cover the turn. `agent` and `Peer.run` return text or the validated `output_schema` value, and raise on failure. `agent` and `agent_run` also accept a `name` for the call's inspection label and bound `context`. Context is a private JSON file beside the assigned goal, not a system-prompt override or data copied into the goal text. A strict schema can be built locally with `schema(shape)`:

```python
import asyncio
names = ["alpha", "beta", "gamma"]
rows = await asyncio.gather(*[
    agent_run(role="code-review-specialist", task="Inspect this path", context={"path": name},
              output_schema=schema({"risk": ["low", "high"], "evidence": "str"}))
    for name in names
])
[{"path": name, "status": row["status"], "value": row.get("value")} for name, row in zip(names, rows)]
```

Peer turns share the host call, concurrency, agent, and wall-clock budgets. Each turn consumes agent budget, including attached and reused peers. Usage is included in the outer result, including usage already spent when a turn is cancelled, and peer tool operations appear in its trace. `schema` is a pure in-sandbox function and does not consume a host call or Monty suspension. A marked `context` passed to `agent_run` is fitted automatically; the returned record's `context.truncated`, `context.dropped`, and `context.serializedChars` show the fit.

## Extensions, fetch, and skills

Each tool Pi lists as callable for the running call is callable by its registered name with schema-checked keyword arguments, for example `await mcp__test__echo(value="hello")` for a connected native MCP server. Use `tools_list()`, `tools_search(query)`, `tools_describe(name)`, and `tools_call(name, args)` for dynamic discovery. `pi_exec` itself, saved `program_*` tools, `monitor`, `remind_me`, `task`, and `search_branches` are not callable inside Monty. Pi owns MCP transport and authentication; the adapter gateway is gone.

The `code` description lists extension tools by name only, so it follows Pi's MCP exposure choice. With `deferred` exposure (recommended, see [MCP](mcp.md)) or Pi's default `codemode` exposure, MCP schemas are absent from the model's direct tool declarations. A program must then call `tools_describe(name)` before first use, or Monty rejects arguments that do not match. Set a server's `exposure` to `direct` in `mcp.json` to show its schemas natively. Monty always type-checks against full signatures for every callable tool.

Extension tools, MCP tools, and active core tools other than `bash` run through Pi's `ctx.executeTool()`. Pi validates their arguments, applies exposure (an inactive `direct` tool is not callable), runs the session's `tool_call` and `tool_result` hooks, and adds their usage to the `pi_exec` result. An active core tool's registered schema is the one Monty checks. `pi_exec` and saved programs declare `reachesTools` as `"all"`, so Pi's MCP support waits for servers that are still connecting before a program starts.

An extension tool call returns `text`, `isError`, `content`, `details`, and `structuredContent` when the tool returns machine-readable data; every MCP tool returns its whole `CallToolResult` there. A failed call raises, unless it also returned `structuredContent`: then it resolves with `isError: true`, as in Pi's codemode. Programs keep their own `bash`, which cannot start background tasks, and Pi's own definitions of inactive core tools; those calls run directly, and `pi_exec` applies the search root guard to them. See [MCP](mcp.md) for configuration.

`fetch(url, method=..., headers=..., body=...)` accepts a URL, optional string headers, and a text or byte request body. It returns status, headers, URL, and a text body for textual responses or bytes for binary responses. Convert bytes before returning a JSON result. Trace summaries omit header values, request bodies, credentials, and URL queries. `skills_list()` and `skills_body(name)` expose only model-invocable skills; bodies omit frontmatter.

## Evidence helpers

`git_change`, `git_patch`, and `repo_change_neighborhood` collect scoped Git evidence. `context_required`, `context_clippable`, and `context_droppable` mark values for `context_fit` or automatic peer-context fitting; `context_pack` prioritizes selected rows under a serialized-character budget. `dev_find_relevant_tests` locates neighboring tests and `dev_run_relevant_tests` executes them with a `{tests}` command template or a package test script. These helpers are host calls and share the normal call, concurrency, trace, and cancellation budgets. Use ordinary Python sets and dictionaries for coverage and ID reconciliation; there is no separate host helper for either.

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

`limits` can adjust call budget, concurrency, agent budget, and timeout within package maxima. The host queues gathered calls above the concurrency limit. Monty enforces a fixed 512 MiB memory limit, feed/turn execution time, recursion, and a session-wide suspension ceiling; the host enforces the per-call wall deadline and call budget. On cancellation, pending host calls are rejected and new calls are refused. Peer cleanup is awaited before the tool reports settlement, so cleanup can outlast the Python deadline; a cleanup failure is reported rather than treated as a successful release. Terminal failures discard the worker and restore the preceding checkpoint on the next call. Completed tool, file, and process effects are **not** undone by that rollback.

Each tool call has a durable trace and live TUI activity. Error results retain the trace through Pi's `tool_result` hook. In a TUI, the card shows a bounded Python preview, active calls, and elapsed time. While a program runs, including a saved `program_*` execution, it appears as one entry in the shared above-editor active-work surface beside other active work, with its name, observed call progress, and elapsed time. Its peer turns belong to that entry; the people themselves also appear in the organization while they are alive. The entry does not open or focus the work panel, and it leaves the surface when the program settles; its outcome and trace stay inspectable in `Ctrl+W`.

## Work-panel inspection

Open `/work` or Ctrl+W and select **Pi Exec** to inspect direct snippets and saved `program_*` executions. The tab shows the selected program's name, supplied objective, execution state, elapsed time, and host calls. A host call is work the script asks the harness to perform, such as a file read, shell command, HTTP request, or peer turn. Queued calls are waiting for a concurrency slot; running calls have acquired one. Call detail separates queue time from execution time and includes the existing trace-safe arguments, activity, result, and error. Counts describe calls already issued, not a percentage of the script's eventual work.

With focus in the panel:

| Key | Action |
| --- | --- |
| `Tab` / `Shift+Tab` | Select the next or previous program |
| `v` | Cycle Calls, Source, Result, and Trace views |
| `[` / `]` | Select the previous or next host call and return to Calls |
| Configured scroll keys, `k`/`j`, page keys, `Home`/`End` | Scroll detail; `End` follows the live tail |

The [shared work-panel controls](tasks.md#work-panel) handle tabs, focus, closing, and responsive placement. Keyboard inspection and fullscreen mouse-wheel scrolling preserve the main editor draft. Each invocation retains its view and scroll position through tab changes, resizing, and panel reopening.

Successful, failed, aborted, and timed-out programs remain inspectable after settlement, with their available result, error, captured output, and operation trace. A failed call remains visible even if the script handles it and succeeds. This inspection history is in memory for the current session/branch only; session replacement, reload, tree navigation, and shutdown clear it. It is not rebuilt from checkpoint or transcript entries.

Peer turns appear as program-owned host calls. Selecting one shows its call label, role or peer id, task, current activity, and live tools. Each tool shows its status, name, trace-safe target, and result or error once it finishes. During parallel execution a tool appears only under the turn that issued it. A failed peer status record stays visible even when the script handles it and the program succeeds. Cancellation waits for cleanup; tool effects that finish during cancellation remain visible rather than being claimed undone. This inspection view offers no resume or steering controls.

Inspection adds no steering or cancellation controls and leaves execution semantics unchanged. Source displays the executed script; call and trace views retain their existing redaction boundaries and omit deliberately excluded payloads.

## Session checkpoints

Each successful feed and ordinary Python exception saves a Monty dump as a custom entry on Pi's session tree. Reload or tree navigation restores the nearest checkpoint on the selected branch. `reset: true` saves an empty checkpoint before executing its snippet, so a failed reset feed still leaves the branch reset. A damaged or incompatible checkpoint starts an empty interpreter and reports a notice; do not treat a recovered empty interpreter as restored state. A checkpoint is compatible only with the exact Python declarations and built-in helper implementations it was saved under. A package update that changes them, or a change in the callable tools, starts an empty interpreter once. Each dump is authenticated with a key in the user-global Pi agent directory before Monty loads it. A copied or altered session whose key is unavailable starts empty with a notice; session files alone do not carry the key. The old JavaScript guest, JSON state IDs, and web polyfills are gone; there is no fallback runtime.

See [organization](organization.md) for people and roles, and [boundaries](boundaries.md) for the adopted integration boundary.

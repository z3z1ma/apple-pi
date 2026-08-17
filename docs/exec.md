# Pi Exec

`pi_exec` executes a JavaScript async-function body in a disposable worker. Intermediate tool output remains inside the program; only its returned value enters the main model context.

`pi_exec` is deliberately available only to the root session. Interactive subagents do not receive it, even when their extension configuration explicitly selects the runtime; nested delegation must use their ownership- and depth-scoped `Agent` tools. This prevents child sessions from bypassing those limits through `agents.run` or the captured root extension-tool catalog.

The packaged [`pi-exec`](../skills/pi-exec) skill has the guest signatures and the common authoring mistakes. Write programs from the live signatures on the `pi_exec` `code` parameter.

## Guest surface

Available globals:

- `pi.read({ path })`, `pi.grep({ pattern })`, `pi.find({ pattern })`, `pi.ls({ path? })`, `pi.bash({ command })`, `pi.edit({ path, edits })`, and `pi.write({ path, content })` — each takes one object matching the parent tool, never a positional string
- `fetch` with `URL`, `URLSearchParams`, `Headers`, `Request`, `Response`, `AbortController`, `AbortSignal`, and `DOMException`
- `TextEncoder`, `TextDecoder`, `atob`, `btoa`, `structuredClone`, and `queueMicrotask`
- `tools.list/search/describe/call` and `extensions.<tool>(args)` for registered Pi extension tools only. The `pi_exec` `code` parameter lists every guest signature, including captured extension tools such as the MCP gateway, before the program is written.
- `agent(taskOrOptions)` for worker text or a typed `outputSchema` value, and `agents.run(options)` for structured status, text, `value`, errors, and usage. Bind JSON-serializable results as `context` instead of interpolating them into `task`.
- ordinary JavaScript branching, loops, `reduce`, and `Promise.all`, plus `parallel(items, mapper, concurrency)` and `pipeline(items, ...stages)`
- `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, and `sleep`
- `inputs.<key>` for separately supplied strings, and `print(...)`/`console.log(...)`

`display` is a `pi_exec` tool parameter, not a guest global. Pass `display: { name, description }` on the tool call so the TUI card and activity widget show intent. Optional `limits: { agentBudget, callBudget, concurrency, timeoutSeconds }` scales that program's envelope up to package maxima.

Agent options include `task`, `type`, `name`, `model`, `thinking`, `tools`, `systemPrompt`, `context`, and `outputSchema`. `type` selects a built-in or Markdown agent from the same catalog as the `Agent` tool and supplies that type's tools, prompt, and model/thinking as defaults. Explicit `tools` / `model` / `thinking` override those defaults. `systemPrompt` appends additional guidance and does not replace the type role. Omit `type` for a generic read-only worker — that is the pattern for review planner/reviewer/verifier roles, which are program prompts, not catalog types. Ralph increments use `type: "general-purpose"` with instructions in the task. Untyped workers default to read-only core tools; a program can explicitly grant any subset of `read`, `grep`, `find`, `ls`, `bash`, `edit`, and `write`. Workers load the ledger and VCC extensions via `--no-extensions` plus `-e`. They cannot call MCP or other host extension tools; gather those results in the program and bind them as `context`. `name` labels the worker row and is passed through to `pi --name`.

`context` is JSON-cloned to a temporary file and attached with Pi's `@file` channel so the payload is not stuffed into argv. `outputSchema` is a JSON Schema object for the worker's return value: the worker loads the ledger and VCC extensions, plus a worker-only `pi_exec_return` tool when a schema is set, via explicit `-e` under `--no-extensions`. The typed arguments become `agents.run.value` / `agent()`'s return; a run that never calls the tool fails. Prefer `agents.run` for fan-out so one failed worker does not abort the program. Pass file paths in `context` or `task`; the worker can `read` them.

Example:

```javascript
const dir = "extensions";
const listing = await pi.ls({ path: dir });
const files = listing.split("\n").filter((name) => name.endsWith(".ts"));
return parallel(files, async (name) => {
  const result = await agents.run({
    task: "Name the riskiest export and quote the evidence.",
    name,
    context: { path: `${dir}/${name}` },
    outputSchema: {
      type: "object",
      properties: {
        export: { type: "string" },
        evidence: { type: "string" },
      },
      required: ["export", "evidence"],
    },
  });
  return { file: name, status: result.status, ...(result.value ?? {}), ...(result.error ? { error: result.error } : {}) };
}, 3);
```

## Envelope, fetch, and traces

Pi Exec derives a default envelope from program shape: host calls, fan-out concurrency, model-worker count, worker memory, and elapsed time. Pass optional `limits` on the tool call to raise or lower agent, call, concurrency, or timeout capacity up to package maxima. The resolved envelope is included in result details; excess fan-out queues instead of failing, and synchronous runaway code is stopped by terminating the disposable worker. There is no Node, direct filesystem, or shell global inside the guest; those effects are available only through explicit bridges.

`fetch` is one of those bridges: requests share the call budget, concurrency limit, deadline, cancellation, live activity, and durable trace. Request and response bodies are buffered and capped at 10 MiB; use `text()`, `json()`, `arrayBuffer()`, or `bytes()` rather than streaming. Request bodies accept strings, `URLSearchParams`, array buffers, and typed-array views. Trace summaries omit header values and request bodies.

`bash`, `edit`, and `write` return `{ ok, output }`; read/search tools return text. `agent` returns text, or the structured `outputSchema` value. `agents.run` and extension calls return structured envelopes. Nested operations—including each subagent's core-tool calls—are preserved in `pi_exec` trace details, so VCC compaction, search, `mode:touched`, and `#N:path` can recover effects without dumping intermediate output into current context. Subagent usage is aggregated across every model turn and attributed to the outer tool result.

## TUI and captured tools

In TUI mode, `pi_exec` has a bounded code-preview card, live queued/running/completed call rows, elapsed time, agent activity, expandable results, and a temporary activity widget above the editor. This deliberately replaces Fabric's much larger activity store/dashboard with one execution-local view.

Registered extension tools are captured at Pi's registered-tool assembly point. apple-pi's MCP adapter registers its token-efficient `mcp` gateway there, so `pi_exec` can discover and invoke MCP calls with the same loops, branching, pipelines, and fan-out used for core tools. Provider-private capabilities that are not represented as Pi tools remain outside the bridge because Pi 0.84 has no public nested provider-tool execution API.

Nested operations are not separate top-level Pi tool calls, so policy extensions driven solely by `tool_call` events see the outer `pi_exec` call rather than each nested operation. Captured tool definitions and core overrides still execute their own enforcement behavior; installations requiring an outer per-call gate should gate or disable `pi_exec` as one capability.

See [`docs/mcp.md`](mcp.md) for the gateway and [`docs/subagents.md`](subagents.md) for how `Agent` differs from `agents.run`.

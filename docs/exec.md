# Pi Exec

`pi_exec` executes a JavaScript async-function body in a disposable worker. Intermediate tool output remains inside the program; only its returned value enters the main model context.

`pi_exec` is deliberately available only to the root session. Interactive subagents do not receive it, even when their extension configuration explicitly selects the runtime; nested delegation must use their ownership- and depth-scoped `agent` tools. This prevents child sessions from bypassing those limits through `agent.run` or the captured root extension-tool catalog.

The packaged [`pi-exec`](../skills/pi-exec) skill has the guest signatures and the common authoring mistakes. Write programs from the live signatures on the `pi_exec` `code` parameter.

## Saved project programs

When a composition is reusable in one project, save its **async-function body** in `.pi/programs/<lowercase-kebab-name>.js`. Do not persist one-off programs. A saved program must begin with a one-line JSDoc `@description`; the normalized filename is its name and the description is its discoverable label:

```javascript
/**
 * @description List changed TypeScript paths for a quick review pass.
 */
const change = await std.git.change({ paths: ["components"] });
return change.changedFiles.filter((path) => path.endsWith(".ts"));
```

- `pi_discover_programs({})` lists the valid saved programs as `{ name, description }` without evaluating them.
- `pi_exec_program({ name, inputs?, state?, limits? })` loads and executes `.pi/programs/<name>.js` with the same bounded guest runtime as `pi_exec`. The JSDoc description supplies its execution label; `inputs`, `state`, and `limits` have the same contracts as `pi_exec`.

Names contain only lowercase letters, numbers, and single hyphens, and are at most 120 characters. The programs directory and files must resolve within the project; only regular `.js` files are accepted. Discovery and execution reject a malformed description rather than guessing it. Both tools require a trusted project because saved programs are repository-owned executable code.

## Guest surface

Available globals:

- `pi.read({ path })`, `pi.grep({ pattern })`, `pi.find({ pattern })`, `pi.ls({ path? })`, `pi.bash({ command })`, `pi.edit({ path, edits })`, and `pi.write({ path, content })` — each takes one object matching the parent tool, never a positional string
- `fetch` with `URL`, `URLSearchParams`, `Headers`, `Request`, `Response`, `AbortController`, `AbortSignal`, and `DOMException`
- `TextEncoder`, `TextDecoder`, `atob`, `btoa`, `structuredClone`, and `queueMicrotask`
- `tools.list/search/describe/call` and `extensions.<tool>(args)` for eligible registered Pi extension tools. Interactive subagent tools (`agent`, result retrieval, steering, and stopping) are excluded because `agent()` / `agent.run()` is the runtime-owned worker abstraction. The `pi_exec` `code` parameter lists every available guest signature, including captured extension tools such as the MCP gateway, before the program is written.
- `agent(taskOrOptions)` for worker text or a typed `outputSchema` value, and `agent.run(options)` for structured status, text, `value`, errors, and usage. Bind JSON-serializable results as `context` instead of interpolating them into `task`.
- ordinary JavaScript branching, loops, `reduce`, and `Promise.all`, plus `parallel(items, mapper, concurrency)` and `pipeline(items, ...stages)`
- `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, and `sleep`
- `inputs.<key>` for separately supplied strings, mutable `state` for reusable serialized data, and `print(...)`/`console.log(...)`

`state` starts empty unless the tool call passes a state ID returned by an earlier call. When a successful program changes it, the result includes a new `state: <id>` line; pass that ID as the next call's `state` parameter. IDs are immutable and scoped to the live root session, so one snapshot can seed independent calls; failed and read-only calls create nothing. State accepts JSON objects, arrays, and primitives and rejects values that would serialize lossily. A snapshot is capped at 200,000 serialized bytes; each session retains at most 32 snapshots and 1,000,000 bytes, with bounded process-wide retention and oldest-first eviction. Session shutdown removes that session's snapshots, and no snapshot survives an extension or process restart.

`display` is a `pi_exec` tool parameter, not a guest global. Pass `display: { name, description }` on the tool call so the TUI card and activity widget show intent. Optional `limits: { agentBudget, callBudget, concurrency, timeoutSeconds }` scales that program's envelope up to package maxima.

Agent options include `task`, `type`, `name`, `profile`, `tools`, `pair`, `systemPrompt`, `context`, and `outputSchema`. `type` selects a built-in or Markdown agent from the same catalog as the `agent` tool and supplies that type's tools, prompt, and default semantic model profile. The builder enables the pair programmer by default; `pair: false` explicitly opts out. Other types use their agent-definition pair programmer default. An explicit `profile` overrides only model/thinking; it never changes capabilities. Explicit `tools` still override the type's tool set. `systemPrompt` appends additional guidance and does not replace the type role. Omit `type` for a generic read-only worker — that is the pattern for review planner/reviewer/verifier roles, which are program prompts, not catalog types. A generic worker may select a model/thinking bundle with `profile`; with no profile it inherits the parent session. Ralph is also a program-only role: its worker receives the `coding` profile, an explicit system prompt, and a write-capable tool list rather than a catalog type. Untyped workers default to read-only core tools; a program can explicitly grant any subset of `read`, `grep`, `find`, `ls`, `bash`, `edit`, and `write`. Workers inherit the root session's project-trust decision: typed workers may resolve project agent definitions only when trusted, and the child Pi process receives the matching `--approve` or `--no-approve` flag. Workers load vroom (fast mode), automatic-compaction safety/fallback, the [search root guard](home-search-guard.md), ledger, and `search_session` extensions via `--no-extensions` plus `-e`. They cannot call MCP or other host extension tools; gather those results in the program and bind them as `context`. `name` labels the worker row and is passed through to `pi --name`.

`context` is JSON-cloned to a temporary file and attached with Pi's `@file` channel so the payload is not stuffed into argv. `outputSchema` is a JSON Schema object for the worker's return value: the worker loads vroom (fast mode), automatic-compaction safety/fallback, the search root guard, ledger, and `search_session` extensions, plus a worker-only `pi_exec_return` tool when a schema is set, via explicit `-e` under `--no-extensions`. The typed arguments become `agent.run.value` / `agent()`'s return; a run that never calls the tool fails. Prefer `agent.run` for fan-out so one failed worker does not abort the program. Pass file paths in `context` or `task`; the worker can `read` them.

Example:

```javascript
const dir = "extensions";
const listing = await pi.ls({ path: dir });
const files = listing.split("\n").filter((name) => name.endsWith(".ts"));
return parallel(files, async (name) => {
  const result = await agent.run({
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

## Guest standard library

`std` is deliberately small. A function belongs here only when it adds material semantics beyond JavaScript, `pi.*`, `pi.bash`, `fetch`, `agent` / `agent.run`, `parallel`, or `pipeline`. The live `code` parameter documents complete input/output types.

| Namespace | Contract |
| --- | --- |
| `git` | `change()` gathers normalized status, compact `statusText`, patch, statistics, changed paths, untracked paths, renames, and line totals. `patch()` gathers only a unified diff. |
| `repo` | `changeNeighborhood()` adds requested definitions, references, neighboring tests, configuration, and ownership evidence. |
| `context` | Required/clippable/droppable markers, serialized-budget fitting with optional truncation flags, and priority packing with per-field clipping. |
| `coverage`, `reconcile` | Explicit coverage comparison and ID-based overlay reconciliation. |
| `dev` | Relevant-test discovery and bounded execution. |
| `schema` | Strict JSON Schema from terse object shapes. |

There are intentionally no wrappers for assertions, collections, text clipping, shell, filesystem reads, HTTP, ordinary graphs, single agents, generic semantic prompts, provenance, or writes. `std.git`, `std.repo`, and `std.context` are read-only. `std.dev.runRelevantTests` is the only direct host-command executor: custom commands require `{tests}` and `maxTests` defaults to 128, failing rather than truncating.

```javascript
const change = await std.git.change({ compare: "HEAD", paths: files });
const planning = std.context.fit({
  files: std.context.required(files),
  patch: std.context.clippable(change.patch, { maxChars: 12_000, priority: 100 }),
}, { maxSerializedChars: 16_000, flags: { patchTruncated: "$.patch" } });
const workers = await parallel(files, (path) => agent.run({
  task: "Inspect this changed path.",
  context: { path, ...planning.value },
  outputSchema: std.schema({ path: "string", risk: "string" }),
}), 2);
```

Flags require an unmarked object root so they cannot disappear behind a root mark.

`std.context.pack` clips selected string fields before serialized-size packing and returns their original paths in `clipped`:

```javascript
const candidates = std.context.pack(rows, {
  maxSerializedChars: 12_000,
  id: "id",
  priority: "severity",
  fields: { title: 180, evidence: 700 },
});
```

Marks nested anywhere in an `agent()` or `agent.run()` context are automatically fitted to the default channel budget before attachment. Plain contexts are unchanged. `agent.run()` reports automatic `context.truncated`, `context.dropped`, and `context.serializedChars`; use `std.context.fit` when the program needs explicit control or in-context flags.

`std.schema({ id: "int", title: "string", note: "string?", severity: ["high", "low"], findings: ["string"], line: { int: { minimum: 1 } }, paths: { array: { minItems: 1 }, items: ["string"] } })` compiles to strict JSON Schema: fields are required unless suffixed with `?`, objects reject extra fields, two-or-more string arrays are enums, and a one-item array defines items. The constrained forms preserve numeric validation.

Use `std.dev.findRelevantTests()` for discovery without execution. `std.dev.runRelevantTests()` executes only discovered neighboring tests, forwarding them after `--` to package `test:unit` / `test`, or replacing `{tests}` in a supplied command template. No tests or runnable command produces an explicit `not_run` result. Use `pi.write`, `pi.edit`, and `pi.bash` directly for other authorized effects.

## Envelope, fetch, and traces

Pi Exec derives a default envelope from program shape: host calls, fan-out concurrency, model-worker count, worker memory, and elapsed time. Pass optional `limits` on the tool call to raise or lower agent, call, concurrency, or timeout capacity up to package maxima. The resolved envelope is included in result details; excess fan-out queues instead of failing, and synchronous runaway code is stopped at the configured `timeoutSeconds` deadline. There is no Node, direct filesystem, or shell global inside the guest; those effects are available only through explicit bridges.

`fetch` is one of those bridges: requests share the call budget, concurrency limit, deadline, cancellation, live activity, and durable trace. Request and response bodies are buffered and capped at 10 MiB; use `text()`, `json()`, `arrayBuffer()`, or `bytes()` rather than streaming. Request bodies accept strings, `URLSearchParams`, array buffers, and typed-array views. Trace summaries omit header values and request bodies.

`bash`, `edit`, and `write` return `{ ok, output }` for success and failure; read/search tools return text. Every host-call argument and result, program return value, and state snapshot must cross the same strict JSON boundary—non-plain objects, BigInt, sparse arrays, cycles, accessors, and other lossy values fail instead of silently becoming a different value. Optional helper lookups such as an unknown `tools.describe()` name preserve `undefined` inside the guest without weakening that JSON boundary. `agent` returns text, or the structured `outputSchema` value. `agent.run` and extension calls return structured envelopes. Nested operations—including each subagent's core-tool calls—are preserved in `pi_exec` trace details, so `search_session`, `mode:touched`, and `#N:path` can recover effects without dumping intermediate output into current context. Subagent usage is aggregated across every model turn and attributed to the outer tool result.

## TUI and captured tools

In TUI mode, `pi_exec` has a bounded code-preview card, live queued/running/completed call rows, elapsed time, agent activity, expandable results, and a temporary activity widget above the editor. This deliberately replaces Fabric's much larger activity store/dashboard with one execution-local view.

Eligible extension tools are captured at Pi's registered-tool assembly point. The interactive subagent surface is deliberately filtered out: programs use `agent()` / `agent.run()` rather than `agent`, `get_subagent_result`, `steer_subagent`, or `stop_subagent`. apple-pi's MCP adapter registers its token-efficient `mcp` gateway there, so `pi_exec` can discover and invoke MCP calls with the same loops, branching, pipelines, and fan-out used for core tools. Provider-private capabilities that are not represented as Pi tools remain outside the bridge because Pi 0.84 has no public nested provider-tool execution API.

Nested operations are not separate top-level Pi tool calls, so policy extensions driven solely by `tool_call` events see the outer `pi_exec` call rather than each nested operation. Captured tool definitions and core overrides still execute their own enforcement behavior; installations requiring an outer per-call gate should gate or disable `pi_exec` as one capability.

See [`docs/mcp.md`](mcp.md) for the gateway and [`docs/subagents.md`](subagents.md) for how `agent` differs from `agent.run`.

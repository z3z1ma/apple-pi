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

Agent options include `task`, `type`, `name`, `profile`, `tools`, `advisor`, `systemPrompt`, `context`, and `outputSchema`. `type` selects a built-in or Markdown agent from the same catalog as the `Agent` tool and supplies that type's tools, prompt, and default semantic model profile. Implement enables Advisor by default; `advisor: false` explicitly opts out. Other types use their agent-definition Advisor default. An explicit `profile` overrides only model/thinking; it never changes capabilities. Explicit `tools` still override the type's tool set. `systemPrompt` appends additional guidance and does not replace the type role. Omit `type` for a generic read-only worker — that is the pattern for review planner/reviewer/verifier roles, which are program prompts, not catalog types. A generic worker may select a model/thinking bundle with `profile`; with no profile it inherits the parent session. Ralph is also a program-only role: its worker receives the `coding` profile, an explicit system prompt, and a write-capable tool list rather than a catalog type. Untyped workers default to read-only core tools; a program can explicitly grant any subset of `read`, `grep`, `find`, `ls`, `bash`, `edit`, and `write`. Workers inherit the root session's project-trust decision: typed workers may resolve project agent definitions only when trusted, and the child Pi process receives the matching `--approve` or `--no-approve` flag. Workers load the ledger and `session_search` extensions via `--no-extensions` plus `-e`. They cannot call MCP or other host extension tools; gather those results in the program and bind them as `context`. `name` labels the worker row and is passed through to `pi --name`.

`context` is JSON-cloned to a temporary file and attached with Pi's `@file` channel so the payload is not stuffed into argv. `outputSchema` is a JSON Schema object for the worker's return value: the worker loads the ledger and `session_search` extensions, plus a worker-only `pi_exec_return` tool when a schema is set, via explicit `-e` under `--no-extensions`. The typed arguments become `agents.run.value` / `agent()`'s return; a run that never calls the tool fails. Prefer `agents.run` for fan-out so one failed worker does not abort the program. Pass file paths in `context` or `task`; the worker can `read` them.

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

## Guest standard library

`std` is deliberately small. A function belongs here only when it adds material semantics beyond JavaScript, `pi.*`, `pi.bash`, `fetch`, `agent` / `agents.run`, `parallel`, or `pipeline`. The live `code` parameter documents the complete input and output type of every exposed function.

| Namespace | Contract |
| --- | --- |
| `git` | `change()` concurrently gathers and normalizes status, patch, statistics, changed paths, untracked paths, renames, and line totals. |
| `repo` | `changeNeighborhood()` adds requested definitions, references, neighboring tests, configuration, and ownership evidence for changed files. |
| `context` | Required/clippable/droppable markers plus serialized-budget fitting, priority packing, and budget partitioning. |
| `evidence` | Stable provenance items, bundles, budget packing, and required-ID validation. |
| `coverage`, `reconcile` | ID/identity coverage checks and one-to-one overlay reconciliation with explicit missing, unknown, and duplicate metadata. |
| `agents` | Only `planFanoutReduce()`: a typed planner-created fan-out followed by a typed reducer. |
| `dev` | Generic schema-first change/failure analysis over collected repository evidence, plus relevant-test discovery/execution. |

There are intentionally no `std` wrappers for assertions, collections, text splitting, shell, filesystem reads, HTTP, ordinary graphs, single agents, generic semantic prompts, or writes. Use JavaScript and the already-documented guest APIs directly. `std.git`, `std.repo`, evidence collection, and development analysis are read-only. `std.dev.runRelevantTests` is the only function that directly executes a host command by design: it first discovers neighboring test paths, injects those paths into the command, and reports the real status/output. `std.agents.planFanoutReduce` can also perform caller-authorized effects when a stage is explicitly granted `bash`, `edit`, or `write`; it adds no authority of its own.

### Evidence and context

Use `std.context.fit` instead of reimplementing serialized-size clipping. Required fields either fit or fail; clippable strings shrink by priority; droppable fields are removed first. The return reports exactly what changed.

```javascript
const change = await std.git.change({ compare: "HEAD", paths: files });
const planning = std.context.fit({
  files: std.context.required(files),
  status: std.context.required(change.status),
  patch: std.context.clippable(change.patch, {
    priority: 100,
    maxChars: 12_000,
    strategy: "head-tail",
  }),
  history: std.context.droppable(history, { priority: 10 }),
}, { maxSerializedChars: 48_000 });

const evidence = std.evidence.bundle([
  std.evidence.item({
    kind: "git-diff",
    source: "git",
    locator: { compare: change.compare, paths: change.paths },
    content: planning.value.patch,
    truncated: planning.truncated.includes("$.patch"),
  }),
]);
```

Evidence items have stable IDs, kind, source, locator, content, and truncation state. Use `std.evidence.require`, `std.evidence.pack`, and `std.reconcile.byId` to preserve provenance and coverage across workers.

### Planner-created fan-out

`planFanoutReduce` is the one retained worker topology because the planner-created task list, failure-preserving fan-out envelopes, three explicit profiles, and typed reducer are materially more than `parallel` plus `agents.run`.

```javascript
const workflow = await std.agents.planFanoutReduce(change, {
  plan: {
    prompt: PLANNER,
    profile: "balanced",
    tools: READ_ONLY,
    // Defaults to { fanout: [{ prompt, context?, name? }] }.
  },
  fanout: {
    profile: "quick",
    tools: READ_ONLY,
    concurrency: 6,
    outputSchema: reviewerSchema,
  },
  reduce: {
    prompt: REDUCER,
    profile: "deep",
    tools: READ_ONLY,
    outputSchema: verdictSchema,
  },
});
```

Task policy remains in supplied prompts and schemas. For fixed fan-out, retries, pipelines, or one-off typed calls, use `parallel`, `pipeline`, `agent`, and `agents.run` directly.

### Evidence-backed development analysis

`std.dev.analyzeChange` and `analyzeFailure` require both an instruction and output schema. They collect repository evidence and bind it to one read-only worker instead of offering many overlapping prompt aliases.

```javascript
const risk = await std.dev.analyzeChange({
  compare: "HEAD",
  paths: files,
  instruction: "Identify compatibility risks and cite the changed paths that support each conclusion.",
  schema: {
    type: "object",
    properties: {
      risks: { type: "array", items: { type: "string" } },
    },
    required: ["risks"],
  },
});
```

Use `std.dev.findRelevantTests()` for discovery without execution. `std.dev.runRelevantTests()` executes only the discovered neighboring test paths, forwarding them after `--` to the package `test:unit` / `test` script. For a custom runner, pass a command template such as `npx vitest run {tests}`; `{tests}` is required and is replaced with shell-quoted paths. The global `maxTests` limit defaults to 128; exceeding it fails instead of silently truncating the suite. No tests or runnable command produces an explicit `not_run` result. Use `pi.write`, `pi.edit`, and `pi.bash` directly for other authorized effects; `std` does not duplicate them.

## Envelope, fetch, and traces

Pi Exec derives a default envelope from program shape: host calls, fan-out concurrency, model-worker count, worker memory, and elapsed time. Pass optional `limits` on the tool call to raise or lower agent, call, concurrency, or timeout capacity up to package maxima. The resolved envelope is included in result details; excess fan-out queues instead of failing, and synchronous runaway code is stopped by terminating the disposable worker. There is no Node, direct filesystem, or shell global inside the guest; those effects are available only through explicit bridges.

`fetch` is one of those bridges: requests share the call budget, concurrency limit, deadline, cancellation, live activity, and durable trace. Request and response bodies are buffered and capped at 10 MiB; use `text()`, `json()`, `arrayBuffer()`, or `bytes()` rather than streaming. Request bodies accept strings, `URLSearchParams`, array buffers, and typed-array views. Trace summaries omit header values and request bodies.

`bash`, `edit`, and `write` return `{ ok, output }`; read/search tools return text. `agent` returns text, or the structured `outputSchema` value. `agents.run` and extension calls return structured envelopes. Nested operations—including each subagent's core-tool calls—are preserved in `pi_exec` trace details, so `session_search`, `mode:touched`, and `#N:path` can recover effects without dumping intermediate output into current context. Subagent usage is aggregated across every model turn and attributed to the outer tool result.

## TUI and captured tools

In TUI mode, `pi_exec` has a bounded code-preview card, live queued/running/completed call rows, elapsed time, agent activity, expandable results, and a temporary activity widget above the editor. This deliberately replaces Fabric's much larger activity store/dashboard with one execution-local view.

Registered extension tools are captured at Pi's registered-tool assembly point. apple-pi's MCP adapter registers its token-efficient `mcp` gateway there, so `pi_exec` can discover and invoke MCP calls with the same loops, branching, pipelines, and fan-out used for core tools. Provider-private capabilities that are not represented as Pi tools remain outside the bridge because Pi 0.84 has no public nested provider-tool execution API.

Nested operations are not separate top-level Pi tool calls, so policy extensions driven solely by `tool_call` events see the outer `pi_exec` call rather than each nested operation. Captured tool definitions and core overrides still execute their own enforcement behavior; installations requiring an outer per-call gate should gate or disable `pi_exec` as one capability.

See [`docs/mcp.md`](mcp.md) for the gateway and [`docs/subagents.md`](subagents.md) for how `Agent` differs from `agents.run`.

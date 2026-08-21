---
name: pi-exec
description: "Author or troubleshoot JavaScript passed to pi_exec. Use when asked to compose Pi tools, fetch, captured extension or MCP calls, parallel or pipeline stages, or agent workers in one program; bind context or outputSchema; or fix guest-runtime errors such as invalid pi.* arguments, missing pi_exec_return, or 'display is not defined'. Not for ordinary direct tool calls or interactive Agent collaboration."
---

# Pi Exec Guest API

`pi_exec` runs a JavaScript async-function body. Intermediate tool output stays inside the worker; only the returned value enters the main context.

Write the program from the **live signatures on the `pi_exec` `code` parameter**. That list includes every `pi.*` wrapper, guest global, and captured session extension tool (`extensions.<name>({…})`), including the MCP gateway when captured. Do not rely on runtime discovery for `pi.*` or already-listed extension schemas; use `tools.search` or `tools.describe` only when discovering captured extension tools is itself part of the program.

`display`, `inputs`, and `limits` are parameters on the `pi_exec` tool call, not program assignments.

```javascript
// Tool arguments — not guest code
{
  code: "...",
  display: { name: "Audit runtime surfaces", description: "Collect matching files." },
  inputs: { root: "extensions" },
  limits: { agentBudget: 32, callBudget: 256, concurrency: 8, timeoutSeconds: 1800 },
}
```

Inside `code`, read `inputs.root`; every supplied input value is a string, and a missing key is `undefined`. Never write `display.name = ...` or `display.description = ...`. Never assign `limits` inside the program. Omitted limit fields keep the shape-derived default; values clamp to package maxima.

## Core tools

Each `pi.*` function takes **one object** matching the parent Pi tool. Never pass a positional string.

- `await pi.read({ path: string, offset?: number, limit?: number })` → string
- `await pi.grep({ pattern: string, path?: string, glob?: string, ignoreCase?: boolean, literal?: boolean, context?: number, limit?: number })` → string
- `await pi.find({ pattern: string, path?: string, limit?: number })` → string
- `await pi.ls({ path?: string, limit?: number })` → string
- `await pi.bash({ command: string, timeout?: number })` → `{ ok: boolean, output: string }`
- `await pi.edit({ path: string, edits: [{ oldText: string, newText: string }] })` → `{ ok: boolean, output: string }`
- `await pi.write({ path: string, content: string })` → `{ ok: boolean, output: string }`

Wrong: `pi.read(path)`, `pi.read("file.ts")`, `pi.grep(pattern, path)`.

```javascript
const text = await pi.read({ path: "extensions/runtime.ts" });
const matches = await pi.grep({ pattern: "pi\\.read", glob: "*.ts" });
```

## Other guest APIs

The live `code` parameter lists every host signature, including web methods and captured `extensions.*` tools.

- `await fetch(input: string | URL | Request, init?: RequestInit)` → `Response` (10 MiB body cap)
- `await skills.list()` → `[{ name, description }]` — session skills (package, project, user). `await skills.body({ name })` → SKILL.md body with frontmatter stripped. Throws if the skill is missing.
- `await tools.list()` / `tools.search(query)` / `tools.describe(name)` / `tools.call(name, args)` or `tools.call({ name, args })` — captured extension tools only, not `pi.*`
- `await extensions.<name>(args)` → `{ text, content, details, usage? }`
- `type AgentRequest = string | { task: string, type?, name?, profile?, tools?, advisor?, systemPrompt?, context?, outputSchema? }`
- `await agent(request: AgentRequest)` → `string | JSONValue` — returns the `outputSchema` value when set, otherwise text. Throws if the worker fails.
- `await agents.run(request: AgentRequest)` → `{ status: "completed"|"failed", text: string, value?: JSONValue, error?, usage?, toolCalls }`
- `std` is deliberately small: normalized Git/change-neighborhood evidence, context budgets and clipping, coverage/reconciliation, relevant-test discovery/execution, and strict terse-schema compilation. `std.git.patch` is the cheap narrow-diff path; `std.git.change.statusText` is ready-to-bind status text. `std.context.fit` accepts budget-accounted `flags`, `std.context.pack` clips declared string `fields`, and marked contexts nested anywhere in `agent()` / `agents.run()` are automatically fitted before binding (the latter reports the result in `context`). Use `std.schema({ id: "int", name: "string?" })` for strict output schemas. The live `code` description gives every exposed function's complete input and output type. Use JavaScript, `pi.*`, `pi.bash`, `fetch`, `agent` / `agents.run`, `parallel`, and `pipeline` directly instead of looking for duplicate wrappers. `std.dev.runRelevantTests` is the only function that directly executes a host command by design: it runs discovered neighboring test paths, and a custom command must contain the `{tests}` placeholder, and the global `maxTests` limit defaults to 128 and fails rather than truncating.
- The live `<subagent-team>` block lists every callable teammate with its `name`, configured inference `profile`, and own `description`. The separate `<inference-profiles>` block lists the inference profiles as `{ profile, description }` entries. `type` selects a teammate; `profile` selects an inference profile; `systemPrompt` appends dynamic specialization without replacing the teammate definition or granting capabilities. Implement enables Advisor by default; set `advisor: false` to explicitly opt out. The interactive Agent tool uses the equivalent `subagent_type`, `profile`, and `system_prompt` combination. Explicit `tools` override capabilities. Omit `type` for a generic read-only worker.
- Review planner/reviewer/verifier and Ralph stay custom `systemPrompt` workers. Do not set `type` for those program-specific workers. Ralph explicitly grants its write-capable tool list.
- `context` must be JSON-serializable and is bound as an `@file` attachment. Keep `task` short. Do not interpolate payloads into `task`.
- `outputSchema` must be a JSON Schema object that describes an object; omitted `additionalProperties` becomes `false`. The worker must call `pi_exec_return`; `agents.run.value` / `agent()` receive those arguments. Never `JSON.parse` assistant text.
- Workers load the ledger and `session_search` extensions. A worker with Advisor enabled also loads the Advisor sidecar. Workers do not load `pi_exec` or the subagent manager, and they cannot call MCP. Call MCP and other host extension tools here, then bind the compact result as `context`.
- Prefer `agents.run` for fan-out (one failure does not throw). Use `agent()` when a single worker must succeed.
- Pass file paths in `context` or `task`. The worker already has `read`; do not dump file bodies into the task.
- `await parallel(items, mapper, concurrency?)` or `await parallel(jobs, concurrency?)` → `T[]`
- `await pipeline(items, ...stages)` → `unknown[]`
- `await sleep(ms)` → `void`
- `print(...)` / `console.log|info|warn|error(...)`
- `setTimeout` / `clearTimeout` / `setInterval` / `clearInterval` / `queueMicrotask`
- `URL`, `URLSearchParams`, `Headers`, `Request`, `Response`, `AbortController`, `AbortSignal`, `TextEncoder`, `TextDecoder`, `DOMException`, `atob`, `btoa`, `structuredClone`
- No `process`, `require`, `Buffer`, direct filesystem API, or shell global is available. Use `pi.*`, `fetch`, or captured extension tools for host effects.

`agent` / `agents.run` are pi_exec workers for **composition**: typed lanes in a program graph with core tools, MCP, and bound context. `extensions.Agent({...})` is the interactive subagent tool for **collaboration**: backgrounding, FleetView, steer/stop, and resume. They share the same type catalog. They are not the same API.

## Gather, bind, then run workers

Compose results in the program. Bind them as `context`. Keep `task` as the instruction.

Judge bound tool/MCP results:

```javascript
const rows = await parallel(ids, async (id) => {
  const hit = await extensions.mcp({ tool: "issues.get", args: { id } });
  return { id, text: hit.text };
});
const verdict = await agent({
  task: "Which row is a real regression?",
  name: "judge",
  profile: "deep",
  context: rows,
  outputSchema: {
    type: "object",
    properties: {
      id: { type: "number" },
      reason: { type: "string" },
    },
    required: ["id", "reason"],
  },
});
return verdict.id;
```

Use `std.git.change` and `std.context.fit` to collect and bound repository evidence. For a fixed fan-out, use the existing `parallel` and `agents.run` APIs directly:

```javascript
const change = await std.git.change({ compare: "HEAD", paths: ["src/a.ts", "src/b.ts"] });
const bounded = std.context.fit({
  patch: std.context.clippable(change.patch, { maxChars: 12_000, priority: 100 }),
}, { maxSerializedChars: 16_000 });
return parallel(change.changedFiles, (path) => agents.run({
  task: "Inspect this changed path and name its user-visible consequence.",
  context: { path, patch: bounded.value.patch },
}), 2);
```

List, filter in JavaScript, then fan-out one worker per path:

```javascript
const dir = inputs.root;
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
  return { name, status: result.status, ...(result.value ?? {}), ...(result.error ? { error: result.error } : {}) };
});
```

The worker reads `context.path`. Do not `pi.read` the file in the parent just to stuff the body into `task`.

Select a catalog teammate when the worker should follow that agent definition. Untyped workers default to generic and read-only; program-specific workers such as review and Ralph provide their own `systemPrompt`, and Ralph explicitly grants write-capable tools.

```javascript
const map = await agents.run({
  type: "Explore",
  task: "Where is session compaction owned? Return paths and a concise map.",
  name: "compaction-map",
});
```

Feed one typed worker result into the next. `first` is `{ path }`, not prose:

```javascript
const first = await agent({
  task: "Pick the file that owns the bug.",
  context: { files },
  outputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
});
return agent({
  task: "Explain the bug and the smallest fix.",
  context: first,
  outputSchema: {
    type: "object",
    properties: {
      cause: { type: "string" },
      fix: { type: "string" },
    },
    required: ["cause", "fix"],
  },
});
```

## Authoring rules

- Use `pi_exec` for branching, reduction, or already-justified fan-out. Use direct tools for straightforward sequential inspection.
- Persist a composition only when it is reusable within this project: write its async-function body to `.pi/programs/<lowercase-kebab-name>.js` beginning with a one-line JSDoc `@description`, then use `pi_discover_programs` and `pi_exec_program({ name })`. Do not save one-off programs.
- Await every host call. Do not start a call and return before it settles.
- Keep dependent search → read and edit → verify steps sequential. Never concurrently edit the same file.
- Return a compact value. Do not dump raw file bodies back into the main context.

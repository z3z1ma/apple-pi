# apple-pi

One installable [Pi](https://github.com/badlogic/pi-mono) package for Alex's integrated Pi environment:

- **Pi Advisor** (`/advisor`) — a persistent read-only peer model that reviews turns and sends sparse, severity-tagged advice.
- **Ask User Question** (`ask_user_question`) — a structured TUI/RPC questionnaire for clarifying material decisions without guessing.
- **Integrated context** — VCC's deterministic transcript compaction plus observational memory's model-generated observations and reflections.
- **Recall** — `vcc_recall` progressively recovers transcript and file-operation history; `recall` resolves a specific 12-character memory ID back to source entries.
- **Pi Exec** (`pi_exec`) — a programmable JavaScript composition runtime over Pi tools, extension tools, MCP, and configurable subagents.
- **MCP** (`mcp`, `/mcp`) — the full lazy, token-efficient `pi-mcp-adapter` gateway, installed as an exact package dependency.
- **Interactive subagents** (`Agent`, `/agents`) — Markdown-defined foreground/background agents with nested delegation, steering, live widgets, FleetView, and persisted Pi sessions.
- **First-class review** (`review`, `/review`) — sealed Git scope, optional caller files/folders/globs, planner-opened file partitions and concrete focuses, parallel fresh read-only reviewers, one cycle verifier with a meta-review, and coverage receipts.
- **Ledger task workflows and Ralph loops** (`/skill:ledger-*`, `ralph`, `/ralph`) — self-contained `.ledger/<timestamp>-<slug>/` task graphs, shaping/research/specification/planning/distillation skills, fresh bounded execution, shared review, closure judgment, and user-local run receipts.
- **xAI hosted tools** — injects xAI's built-in `{ type: "web_search" }` and `{ type: "x_search" }` Responses tools on xAI models that use Pi's `openai-responses` API.

apple-pi owns its Advisor, questionnaire, context, memory, exec, subagent, review, Ralph, and xAI hosted-tools source. MCP is the deliberate exception: protocol, transport, OAuth, keyring, and MCP UI maintenance remain with the exact `pi-mcp-adapter` dependency while apple-pi owns its integration boundary.

## Install

From a checkout:

```bash
npm install
pi install /absolute/path/to/apple-pi
```

For project-local activation, add `-l` to `pi install`. Pi loads all extension entrypoints from this one package; no second Pi package or Git submodule is required.

## Usage

### Advisor

The advisor is enabled unless explicitly disabled:

```text
/advisor status
/advisor off
/advisor on
```

It uses the `advisor` entry from a trusted project's `.pi/modes.json`, then global `~/.pi/agent/modes.json` when present. Otherwise it tries `openrouter/z-ai/glm-5.2`. An optional project `WATCHDOG.md` supplies advisor-only review guidance only when Pi trusts the project. After compaction, resume, fork, reload, or tree navigation, the advisor passively re-primes from Pi's active session context before reviewing new work.

The advisor makes additional model calls. Its status and accumulated cost are visible through `/advisor status` and the footer.

### Ask User Question

The `ask_user_question` tool lets the model group up to four related decisions into one questionnaire. Each question presents two to four described options, always includes a custom free-text answer, and can opt into multi-select. Multiple questions use tabs and a final review step in the terminal.

In the TUI, use `↑`/`↓` to move, `Enter` to select, `Space` or `Enter` to toggle multi-select choices, `Tab`/`←`/`→` to change questions, and `Esc` to cancel. Custom answers use Pi's multiline editor. RPC/ACP hosts receive the same questions through native select/input dialogs; multi-select accepts comma-separated option numbers or free text. The tool removes itself from non-interactive runs so the model falls back to ordinary chat questions instead of calling an unusable UI.

### xAI hosted tools

Every xAI request that uses Pi's `openai-responses` API receives xAI's built-in `{ type: "web_search" }` and `{ type: "x_search" }` tools unless the payload already includes that tool. Completions-routed Grok models are left unchanged: switch those models to `openai-responses` against `https://api.x.ai/v1` if they should search. Domain filters, handle filters, and image-search flags are not configured; xAI bills each tool when the model uses it.

### Context and memory

Normal `/compact`, automatic compaction, overflow recovery, and explicit `/pi-vcc` all pass through one `session_before_compact` owner:

1. VCC selects a conversational cut and builds a deterministic summary without a model call.
2. Observational memory folds ledger records up to the same cut.
3. The two summaries and their metadata are returned as one compaction result.

The metadata is intentionally flat: `details.compactor === "pi-vcc"` and `details.type === "om.folded"` coexist so both recall systems recognize the same compaction.

Commands and tools:

- `/pi-vcc` — explicit deterministic compaction
- `/pi-vcc-recall` — interactive history and file-operation search
- `vcc_recall` — model-facing progressive recall:
  - `mode:"touched"` groups write/edit operations by path and entry index.
  - `mode:"file"` searches only write/edit payloads.
  - `query:"#N:path"` recovers a file payload; append `:offset:limit` to page or `:full` for up to 50 KB.
  - `expand:[N]` returns a complete transcript entry.
- `/om:status` and `/om:view` — observational-memory state
- `recall` — exact source recall by observation or reflection ID

VCC settings remain at `~/.pi/agent/pi-vcc-config.json`. Observational-memory operational settings use the `observational-memory` key in global `~/.pi/agent/settings.json` or project `.pi/settings.json`; project values override global values. Its model and thinking level use the `observational-memory` entry in `modes.json` instead, following the same trusted-project then global lookup as other named modes. See [`components/memory/src/config.ts`](components/memory/src/config.ts) for the validated operational keys and defaults.

### Where memory persists

Observations, reflections, and drop records are custom entries in Pi's append-only session JSONL. With Pi's default session directory, files are grouped by working directory under:

```text
~/.pi/agent/sessions/--<cwd>--/*.jsonl
```

Thus memory is durable and project-associated through Pi's session location, but it is **not project-local repository state** and is not shared through Git.

apple-pi intentionally does not create a `.pi/memory` mirror. A mirror would introduce a second source of truth, merge semantics, generated repository noise, and a privacy decision without improving current runtime behavior. If cross-session or team-shared memory becomes a concrete requirement, it should be designed as an explicit store and migration rather than an automatic copy.

### Pi Exec

`pi_exec` executes a JavaScript async-function body in a disposable worker. Intermediate tool output remains inside the program; only its returned value enters the main model context.

`pi_exec` is deliberately available only to the root session. Interactive subagents do not receive it, even when their extension configuration explicitly selects the runtime; nested delegation must use their ownership- and depth-scoped `Agent` tools. This prevents child sessions from bypassing those limits through `agents.run` or the captured root extension-tool catalog.

Available globals:

- `pi.read`, `pi.grep`, `pi.find`, `pi.ls`, `pi.bash`, `pi.edit`, and `pi.write`
- `fetch` with `URL`, `URLSearchParams`, `Headers`, `Request`, `Response`, `AbortController`, and `AbortSignal`
- `TextEncoder`, `TextDecoder`, `atob`, `btoa`, and `structuredClone`
- `tools.list/search/describe/call` and `extensions.<tool>(args)` for registered Pi extension tools
- `agent(taskOrOptions)` for worker text and `agents.run(options)` for structured status, text, errors, and usage
- ordinary JavaScript branching, loops, `reduce`, and `Promise.all`, plus `parallel(items, mapper, concurrency)` and `pipeline(items, ...stages)`
- `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `queueMicrotask`, and `sleep`
- `inputs.<key>` for separately supplied strings, and `print(...)`/`console.log(...)`

Agent options include `task`, `name`, `model`, `thinking`, `tools`, and `systemPrompt`. Agents default to read-only core tools, but a program can explicitly grant any subset of `read`, `grep`, `find`, `ls`, `bash`, `edit`, and `write`.

Example:

```javascript
const tracks = [
  ["runtime", "Inspect extensions/runtime.ts and identify execution risks."],
  ["recall", "Inspect VCC recall and identify context-recovery gaps."],
  ["ux", "Inspect pi_exec rendering and identify missing operator feedback."],
];
const reports = await parallel(tracks, async ([name, task]) => ({
  name,
  report: await agent({ task, name }),
}), 3);
return reports.reduce((summary, report) => ({
  ...summary,
  [report.name]: report.report,
}), {});
```

Pi Exec derives a package-owned envelope from program shape: bounded host calls, fan-out concurrency, model-worker count, worker memory, and elapsed time. Normal model calls never choose those numbers. The resolved envelope is included in result details; excess fan-out queues instead of failing, and synchronous runaway code is stopped by terminating the disposable worker. There is no Node, direct filesystem, or shell global inside the guest; those effects are available only through explicit bridges.

`fetch` is one of those bridges: requests share the call budget, concurrency limit, deadline, cancellation, live activity, and durable trace. Request and response bodies are buffered and capped at 10 MiB; use `text()`, `json()`, `arrayBuffer()`, or `bytes()` rather than streaming. Request bodies accept strings, `URLSearchParams`, array buffers, and typed-array views. Trace summaries omit header values and request bodies.

`bash`, `edit`, and `write` return `{ ok, output }`; read/search tools and `agent` return text. `agents.run` and extension calls return structured envelopes. Nested operations—including each subagent's core-tool calls—are preserved in `pi_exec` trace details, so VCC compaction, search, `mode:touched`, and `#N:path` can recover effects without dumping intermediate output into current context. Subagent usage is aggregated across every model turn and attributed to the outer tool result.

In TUI mode, `pi_exec` has a bounded code-preview card, live queued/running/completed call rows, elapsed time, agent activity, expandable results, and a temporary activity widget above the editor. This deliberately replaces Fabric's much larger activity store/dashboard with one execution-local view.

Registered extension tools are captured at Pi's registered-tool assembly point. apple-pi's MCP adapter registers its token-efficient `mcp` gateway there, so `pi_exec` can discover and invoke MCP calls with the same loops, branching, pipelines, and fan-out used for core tools. Provider-private capabilities that are not represented as Pi tools remain outside the bridge because Pi 0.84 has no public nested provider-tool execution API.

Nested operations are not separate top-level Pi tool calls, so policy extensions driven solely by `tool_call` events see the outer `pi_exec` call rather than each nested operation. Captured tool definitions and core overrides still execute their own enforcement behavior; installations requiring an outer per-call gate should gate or disable `pi_exec` as one capability.

### MCP

apple-pi installs `pi-mcp-adapter` 2.26.0 and exposes its normal `mcp` tool, `/mcp` setup/status panel, `/mcp-auth`, lazy server lifecycle, metadata cache, stdio/HTTP/SSE/socket transports, OAuth/keyring integration, approvals, output guards, prompts/resources, and MCP UI support. It reads the adapter's standard `.mcp.json`, shared global, and Pi override locations.

Run `/mcp setup` for guided configuration or create `.mcp.json` directly. Single calls use the ordinary gateway:

```javascript
await extensions.mcp({ search: "issues" });
await extensions.mcp({ tool: "github_search_issues", args: { query: "is:open" } });
```

Inside `pi_exec`, the same gateway becomes a programmable capability:

```javascript
const candidates = await extensions.mcp({ search: "fetch issue", server: "github" });
const ids = [101, 102, 103];
return Promise.all(ids.map(async (id) => {
  const result = await extensions.mcp({
    tool: "github_get_issue",
    args: { owner: "acme", repo: "app", issue_number: id },
  });
  return { id, text: result.text };
}));
```

The adapter's separate `mcpScript` VM is intentionally filtered out: `pi_exec` is the one programmable runtime and can compose MCP with Pi core tools, extension tools, and model agents. Direct MCP tools configured by the adapter remain available to ordinary Pi turns and are also discoverable through `pi_exec`'s extension catalog.

### Interactive subagents

The `Agent` tool launches named agent *types* in foreground or background. `get_subagent_result` waits for or inspects background work, `steer_subagent` redirects a running agent after its current tool, and `stop_subagent` terminates queued or running work. `/agents` lists the live roster and discovered types. In TUI mode, active work appears in the above-editor widget and the navigable below-editor FleetView; the conversation viewer supports live scrolling, steering, and explicit stopping.

Agent definitions are Markdown with YAML frontmatter, discovered in this order:

1. `.pi/agents/*.md`
2. `.agents/agents/*.md`
3. `$PI_CODING_AGENT_DIR/agents/*.md` (normally `~/.pi/agent/agents/*.md`)

```markdown
---
name: reviewer
description: Reviews changes for correctness and missing evidence
model: anthropic/claude-opus-4-6
thinking: high
tools: read, grep, find, bash
extensions: true
skills: true
max_turns: 30
allowed_subagents: scout
---

Review the requested change. Report concrete findings with file paths and evidence.
```

Trusted agent definitions and settings control tool/extension scope, skills, model/thinking, turn limits with graceful wrap-up, session persistence, and explicit nested-agent allowlists. Each `Agent` invocation explicitly chooses `inherit_context` and `advisor`, both `false` by default: without inherited context, the task prompt is the complete handoff; setting `inherit_context: true` prepends the full parent conversation. The continuous second-model advisor remains off unless an invocation explicitly sets `advisor: true`; reserve it for correctness-critical implementation work rather than routine exploration. `max_turns` is a trusted definition-level run-length cutoff, not a model-facing output-size budget: omit it for an unlimited investigation. A turn-limited agent receives a comprehensive wrap-up instruction and retains the model's normal per-response output allowance; settled `get_subagent_result` calls return that final response in full. Nested children are ownership-scoped and depth-limited; they can be inspected, steered, or stopped only by the agent that launched them.

Built-in agent types can also be routed through the shared `modes.json` mechanism without editing TypeScript. Named entries such as `Explore`, `Plan`, and `general-purpose` override the embedded built-in default for those agent types when the project is trusted or when the global mode is used. `provider` and `modelId` select a model together; `thinkingLevel` is independent, so a route may set only thinking. Custom Markdown agent files still win: a file's frontmatter `model:`/`thinking:` override the route, and an explicit `model` argument passed to the Agent tool remains highest precedence.

```json
{
  "modes": {
    "general-purpose": { "provider": "anthropic", "modelId": "claude-3-7-sonnet-20250219", "thinkingLevel": "medium" },
    "Explore": { "provider": "openai-codex", "modelId": "gpt-5.6-luna", "thinkingLevel": "medium" },
    "Plan": { "provider": "openai-codex", "modelId": "gpt-5.6-sol", "thinkingLevel": "xhigh" }
  }
}
```

Top-level subagents persist as normal Pi child-session JSONL by default. The child loads apple-pi's context extension, so its long run uses the same single VCC compaction owner, observational-memory ledger, `vcc_recall`, and exact `recall` tools as the main session. There is no plugin-specific memory directory and no duplicate `.output` transcript. Set `persist_session: false` only when a definition should be ephemeral. Operational defaults can be overridden globally or per project in `subagents.json`; retained settings are `maxConcurrent`, `defaultMaxTurns`, `graceTurns`, `defaultJoinMode`, `strictAgentFiles`, `disableDefaultAgents`, `fleetView`, `persistAgentSessions`, `widgetMode`, `maxSubagentDepth`, and `fallbackSubagent`.

A foreground result includes its agent ID. Pass that ID back through the `Agent` tool's `resume` parameter to continue the same `AgentSession`, including its prior conversation, compactions, and observational memory; `steer_subagent` and `stop_subagent` remain limited to agents that are currently running or queued. `get_subagent_result` is non-blocking by default; `wait_seconds` explicitly chooses a 0–60 second wait, after which it returns the live status without stopping the child so the parent can inspect, steer, or work in parallel. Use `transcript_tail` to inspect up to 12,000 characters from the latest 1–20 child conversation messages, including current streaming output. Ownership-scoped nested agents expose the same check-in surface. Continuation is currently in-process: completed records are retired after about ten minutes, and a parent-session reload, switch, or shutdown does not rehydrate them from the persisted child JSONL.

The imported implementation deliberately has **no worktree parameter or worktree code**, **no scheduled agents**, **no human `@agent` input interception**, **no plugin-local agent memory**, and **no duplicate output-transcript store**. Agents can still use ordinary `bash` when they intentionally need Git or worktrees. Agent-to-agent coordination remains available through explicit `allowed_subagents`, result retrieval, steering, and stopping.

### First-class review

`review` is designed primarily for model-driven use and defaults to the current workspace. The tool's optional `root` lets an agent select a repository beneath its current directory or a linked worktree elsewhere; relative roots resolve from the caller cwd. It seals the selected Git input, asks the dedicated `review-planner` route to open file partitions with concrete focuses, runs those focuses as fresh read-only agents in parallel, then has one verifier decide the pile and write a meta-review. Distinct findings that share a path stay distinct and are grouped for presentation. `thorough` may repeat the cycle against residuals.

```text
/review preview
/review run
/review run workspace --root ../feature-worktree
/review run range --root repos/service-a --from main --to HEAD --profile balanced
/review run commit --commit abc123 --profile thorough
/review status [run-id]
/review stop <run-id>
```

Planning uses `review-planner`; reviewers use `review-routine`; the verifier uses `review-rigorous`. A selected file is covered once a successful focus reviewed it. A run is complete only after first-cycle verification also finishes. These entries come from trusted project or global `modes.json`, and missing entries defer to the caller's active model. Reviewers may read outside their assigned files to trace dependencies, but findings must name a patch-introduced cause in an assigned path.

Workspace review supports dirty and unborn repositories. Binary changes are visible waivers, and a file stays complete if any covering focus succeeded. Receipts are stored outside the repository under `$PI_CODING_AGENT_DIR/reviews/runs/`.

See [`docs/review.md`](docs/review.md) for pipeline invariants, model routing, finding schema, trust boundaries, cycle/focus caps, and Ralph integration.

### Ledger task workflows and Ralph loops

One task is one self-contained `.ledger/YYYYMMDDhhmm-slug/` bundle with an executable `task.md` plus only the specs, plans, research, decisions, evidence, knowledge, and candidate skills that task needs. `.ledger/README.md` indexes task paths without duplicating status. Tasks may depend on completed task roots; supporting records stay private to their owning bundle. Teams normally ignore `/.ledger/`, while solo developers may commit it. Ralph seals ledger authority in either mode.

The packaged lifecycle skills make shaping first-class:

```text
/skill:ledger-shape-task
/skill:ledger-research-task
/skill:ledger-specify-task
/skill:ledger-plan-task
/skill:ledger-execute-task
/skill:ledger-distill-close-task
```

Ralph compiles the shaped task graph, launches a fresh executor for one bounded iteration, invokes the shared review controller, and launches a fresh read-only judge to close, block, stop, or request another iteration. No role inherits parent conversation or resumes a prior role session. The model-facing `ralph` tool is the primary orchestration interface; `/ralph` provides human operational parity.

```text
/ralph inspect .ledger/202608151430-example/task.md
/ralph start .ledger/202608151430-example/task.md
/ralph step <run-id>
/ralph run .ledger/202608151430-example/task.md
/ralph run .ledger/202608151430-example/task.md --root ../task-worktree --ledger-root /absolute/main-checkout
/ralph status [run-id]
/ralph stop <run-id>
```

`step` performs one complete executor → review → judge iteration. `run` repeats only when judgment says `iterate`, under harness-owned iteration, lifetime-token, review-concurrency, per-agent-turn, and elapsed-time ceilings. Normal model and slash-command calls do not configure the numeric arithmetic; compaction invalidates the curated-window premise and stops the affected coverage with an explicit cause.

The implementation checkout must have an established Git `HEAD` and be clean at start. The model tool accepts `root` for a linked implementation worktree and `ledger_root` for the linked checkout containing authoritative `.ledger`. When the ledger is committed and current in the worktree, omit `ledger_root`; when `/.ledger/` is ignored, point `ledger_root` at the main checkout. Ralph verifies both roots share the trusted session repository's Git common directory, leases the implementation workspace and task bundle, and reviews the targeted worktree. It never creates or removes worktrees, commits, stages, pushes, deploys, resets, cleans, or stashes; those remain explicit human/orchestrator decisions.

Executors cannot edit `.ledger`; the controller records structured Journal, Evidence, Blockers, Retrospective, and Distillation with compare-and-swap semantics. Review and judgment remain in authoritative `task.md`; `Status: done` changes only after deterministic evidence, review, retrospective, and distillation gates hold. Machine receipts are keyed by implementation worktree and stay user-local under `$PI_CODING_AGENT_DIR/ralph/runs/`.

See [`docs/ledger.md`](docs/ledger.md) for the artifact model and complete skill flow, and [`docs/ralph.md`](docs/ralph.md) for traversal, execution, budgets, receipts, and safety boundaries. Runtime-private procedures remain packaged as `ralph-executor`, `ralph-judge`, `review-planner`, `reviewer`, and `review-verifier`.

## Reference-repository decisions

| Reference | Adopted | Not adopted |
| --- | --- | --- |
| `rpiv-ask-user-question` | Structured 1-4 question schema, described options, custom and multi-select answers, tabbed TUI review, RPC dialog fallback, non-UI reconciliation, and structured results. | Previews, notes, localization, configuration, collapse mode, external-editor integration, lifecycle events, and upstream runtime dependencies. |
| `pi-blackhole` and Sting8k VCC | One compaction owner, one combined VCC + memory summary, metadata readable by both systems, touched-file aggregation, file-payload search indicators, and scoped `#N:path` drill-down with paging. | Their code, unified overloaded memory/transcript tool, reverse entry-to-memory recall, manual disk buffers, model fallback/cooldown machinery, settings UI, and host/runtime patch layers. Exact memory-ID `recall` and progressive transcript/file `vcc_recall` remain separate. |
| `pi-fabric` | The full core `exec` primitive: bounded guest code; core, extension, and MCP tool bridges; discovery; configurable fan-out; structured subagents; branching, reduction, parallel and pipeline composition; timers; compact final values; usage accounting; durable traces; code previews; live call rendering; and an activity widget. | QuickJS/WASM, compile-time TypeScript checking, Fabric's own MCP/provider registry, approvals subsystem, compaction, actors/teams, mesh, full dashboard, durable workflow state, and alternate runtimes. `pi_exec` uses a disposable Node worker and delegates MCP protocol ownership to `pi-mcp-adapter`. |
| `pi-mcp-adapter` | The complete adapter as an exact runtime dependency, including protocol transports, lazy discovery, auth, approvals, output guarding, prompts/resources, setup UI, and its single `mcp` gateway. | Its standalone `mcpScript` runtime and skill; `pi_exec` owns scripting. The dependency is not copied or patched internally. |
| `pi-subagents` | Owned Markdown agent discovery, Pi `AgentSession` execution, foreground/background queueing, resume/steer/result tools, nested delegation, usage/compaction accounting, completion grouping, activity widget, FleetView, and conversation viewer. | Worktree isolation, scheduling, human `@agent` routing, plugin-local memory, duplicate output transcripts, cross-extension RPC, and model-scope policy. Removed features have no schema fields or dormant implementation. |
| `10x` | Conceptual foundations: typed engineering records, cold-start execution, evidence-gated closure, independent review, and retrospective learning. Apple-pi adapts those ideas into task-local `.ledger` bundles and on-demand lifecycle skills. | The `.10x` global ontology and name, always-on instruction injection, a second task database, unbounded loops, automatic promotion, static answer-key harnesses, or external/destructive autonomy. Machine receipts remain operational and user-local. |

Additional boundaries:

- **No separate package graph.** Components are internal source directories; the root manifest is the only Pi package. MCP is an ordinary pinned npm dependency, not another installed Pi package or linked repository.
- **One review engine.** Standalone review and Ralph use the same scope, planner-opened partitions, parallel review, verification, anchoring, coverage, and receipt controller.
- **One compaction hook.** Observational memory does not register its upstream compaction hook independently.
- **Session ledger is authoritative.** Compaction projects memory but does not relocate it.
- **No compatibility implementation.** There is one current path, not old/new variants.

## Development

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run pack:check
```

See [`docs/development.md`](docs/development.md) for module conventions, formatting, linting, and the rationale for retained cohesive modules.

The VCC suite runs under Bun because its upstream tests use `bun:test`; memory and apple-pi integration tests run under Vitest. The advisor's offline harness uses the locally installed Pi distribution. Networked advisor E2E remains opt-in with `ADVISOR_E2E=1 npm run test:advisor`.

## Provenance

The imported source commits and license notices are recorded in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). New apple-pi code and the combined work are MIT licensed.

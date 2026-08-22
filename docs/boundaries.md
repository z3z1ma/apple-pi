# Reference-repository decisions

Absence is often an architectural choice, not unfinished work. Consult this table before restoring a missing feature.

| Reference | Adopted | Not adopted |
| --- | --- | --- |
| `rpiv-ask-user-question` | Structured 1-4 question schema, described options, custom and multi-select answers, tabbed TUI review, RPC dialog fallback, non-UI reconciliation, and structured results. | Previews, notes, localization, configuration, collapse mode, external-editor integration, lifecycle events, and upstream runtime dependencies. |
| `pi-blackhole` and Sting8k VCC | `session_search` progressive touched-file / `#N:path` recall. | The VCC compiler as a compact-hook owner, `/pi-vcc`, `/pi-vcc-recall`, unified overloaded memory/transcript tool, reverse entry-to-memory recall, manual disk buffers, model fallback/cooldown machinery, settings UI, and host/runtime patch layers. Exact memory-ID `memory_source` and progressive transcript/file `session_search` remain separate. xAI Responses sessions compact server-side; other models use Pi default summarization. |
| `pi-fabric` | The full core `exec` primitive: bounded guest code; core, extension, and MCP tool bridges; discovery; configurable fan-out; structured subagents; branching, reduction, parallel and pipeline composition; timers; compact final values; usage accounting; durable traces; code previews; live call rendering; and an activity widget. | QuickJS/WASM, compile-time TypeScript checking, Fabric's own MCP/provider registry, approvals subsystem, compaction, actors/teams, mesh, full dashboard, durable workflow state, and alternate runtimes. `pi_exec` uses a disposable Node worker and delegates MCP protocol ownership to `pi-mcp-adapter`. |
| `pi-mcp-adapter` | The complete adapter as an exact runtime dependency, including protocol transports, lazy discovery, auth, approvals, output guarding, prompts/resources, setup UI, and its single `mcp` gateway. | Its standalone `mcpScript` runtime and skill; `pi_exec` owns scripting. The dependency is not copied or patched internally. |
| `pi-subagents` | Owned Markdown agent discovery, Pi `AgentSession` execution, foreground/background queueing, resume/steer/result tools, nested delegation, usage/compaction accounting, completion grouping, activity widget, FleetView, and conversation viewer. | Worktree isolation, scheduling, human `@agent` routing, plugin-local memory, duplicate output transcripts, cross-extension RPC, and model-scope policy. Removed features have no schema fields or dormant implementation. |
| `10x` | Inspiration for typed engineering records, cold-start execution, evidence-gated closure, independent review, and retrospective learning. | No migration or compatibility relationship; apple-pi's `.ledger` workbench is an independent system. |

Additional boundaries:

- **No separate package graph.** Components are internal source directories; the root manifest is the only Pi package. MCP is an ordinary pinned npm dependency, not another installed Pi package or linked repository.
- **One compaction hook.** Observational memory does not register a compact hook. It appends its packet on the `context` event after any compaction entry.
- **Session ledger is authoritative.** Compaction projects memory but does not relocate it.
- **Backlog is parked session state, not a second task system.** It follows Pi session branches. The model may take an item when it begins active work; promotion into Ledger still requires an explicit human/model decision and successful task creation. Human management owns editing, arbitrary deletion, and ordering. The backlog is not stored as a repository file.
- **No compatibility implementation.** There is one current path, not old/new variants.

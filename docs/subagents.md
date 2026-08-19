# Interactive subagents

The `Agent` tool launches named agent *types* in foreground or background. `get_subagent_result` waits for or inspects background work, `steer_subagent` redirects a running agent after its current tool, and `stop_subagent` terminates queued or running work. `/agents` lists the live roster and discovered types. In TUI mode, active work appears in the above-editor widget and the navigable below-editor FleetView; the conversation viewer supports live scrolling, steering, and explicit stopping.

`Agent` and `pi_exec` `agents.run` share the type catalog and serve different jobs. Use `Agent` for collaboration: background specialists, FleetView, steer/stop, resume, and a durable child session. Use `pi_exec` for composition: a program graph that fans out typed workers, binds MCP or tool results as `context`, and reduces to a compact value. The parent session remains a senior engineer who may implement; specialists exist to isolate context, pick a model class, or run non-overlapping parallel work.

Built-in types:

| Type | Lane | Default tools |
| --- | --- | --- |
| `Explore` | Local recon: where is X? | read-only |
| `Research` | External docs via MCP and cited sources; not local recon | read-only |
| `Plan` | How-to-implement across modules | read-only |
| `Counsel` | Should we / root cause / YAGNI. Not Advisor, not pi-review | read-only |
| `Implement` | Bounded specified writes. No research, no UI taste | write |
| `Design` | User-visible layout, interaction, polish | write |
| `general-purpose` | Substantial mixed work that does not fit a lane | write |

One isolated, known-path, low-risk action stays in the parent. Do not use `general-purpose` when a lane fits. Review keeps its own `systemPrompt` roles and must not be retargeted onto these types. Ralph increments use `type: "general-purpose"` with instructions in the task.

## Definitions

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
skills: true
max_turns: 30
allowed_subagents: scout
---

Review the requested change. Report concrete findings with file paths and evidence.
```

Trusted agent definitions and settings control tool scope, skills, model/thinking, turn limits with graceful wrap-up, session persistence, and explicit nested-agent allowlists. Interactive children do not discover package extensions. They load ledger, `session_search`, and MCP via `--no-extensions` plus `-e`; `advisor: true` also loads the Advisor sidecar for correctness-critical implementation. Agent-definition `extensions:` is ignored. Each `Agent` invocation explicitly chooses `inherit_context`, `false` by default: without inherited context, the task prompt is the complete handoff; setting `inherit_context: true` prepends the full parent conversation. Keep `advisor` false for exploration, search, planning, and routine work. `max_turns` is a trusted definition-level run-length cutoff, not a model-facing output-size budget: omit it for an unlimited investigation. A turn-limited agent receives a comprehensive wrap-up instruction and retains the model's normal per-response output allowance; settled `get_subagent_result` calls return that final response in full. Nested children are ownership-scoped and depth-limited; they can be inspected, steered, or stopped only by the agent that launched them.

## Model routing

Built-in agent types can also be routed through the shared `modes.json` mechanism without editing TypeScript. Named entries such as `Explore`, `Plan`, `Research`, `Counsel`, `Implement`, `Design`, and `general-purpose` override the embedded built-in default for those agent types when the project is trusted or when the global mode is used. `provider` and `modelId` select a model together; `thinkingLevel` is independent, so a route may set only thinking. Custom Markdown agent files still win: a file's frontmatter `model:`/`thinking:` override the route, and an explicit `model` argument passed to the Agent tool or `agents.run` remains highest precedence.

```json
{
  "modes": {
    "general-purpose": { "provider": "anthropic", "modelId": "claude-3-7-sonnet-20250219", "thinkingLevel": "medium" },
    "Explore": { "provider": "openai-codex", "modelId": "gpt-5.6-luna", "thinkingLevel": "medium" },
    "Research": { "provider": "openai-codex", "modelId": "gpt-5.6-luna", "thinkingLevel": "medium" },
    "Plan": { "provider": "openai-codex", "modelId": "gpt-5.6-sol", "thinkingLevel": "xhigh" },
    "Counsel": { "provider": "openai-codex", "modelId": "gpt-5.6-sol", "thinkingLevel": "xhigh" },
    "Implement": { "provider": "openai-codex", "modelId": "gpt-5.6-luna", "thinkingLevel": "high" },
    "Design": { "provider": "openai-codex", "modelId": "gpt-5.6-luna", "thinkingLevel": "medium" }
  }
}
```

## Persistence and check-in

Top-level subagents persist as normal Pi child-session JSONL by default. The child loads standalone `session_search`. A long child run uses Pi default compaction unless the child is given the xAI compaction extension; it does not load observational memory or `memory_source`. There is no plugin-specific memory directory and no duplicate `.output` transcript. Set `persist_session: false` only when a definition should be ephemeral. Operational defaults can be overridden globally or per project in `subagents.json`; retained settings are `maxConcurrent`, `defaultMaxTurns`, `graceTurns`, `defaultJoinMode`, `strictAgentFiles`, `disableDefaultAgents`, `fleetView`, `persistAgentSessions`, `widgetMode`, `maxSubagentDepth`, and `fallbackSubagent`.

A foreground result includes its agent ID. Pass that ID back through the `Agent` tool's `resume` parameter to continue the same `AgentSession`, including its prior conversation and compactions; `steer_subagent` and `stop_subagent` remain limited to agents that are currently running or queued. `get_subagent_result` is non-blocking by default; `wait_seconds` explicitly chooses a 0–300 second wait, after which it returns the live status without stopping the child so the parent can inspect, steer, or work in parallel. Use `transcript_tail` to inspect up to 12,000 characters from the latest 1–20 child conversation messages, including current streaming output. Ownership-scoped nested agents expose the same check-in surface. Continuation is currently in-process: completed records are retired after about ten minutes, and a parent-session reload, switch, or shutdown does not rehydrate them from the persisted child JSONL.

The imported implementation deliberately has **no worktree parameter or worktree code**, **no scheduled agents**, **no human `@agent` input interception**, **no plugin-local agent memory**, and **no duplicate output-transcript store**. Agents can still use ordinary `bash` when they intentionally need Git or worktrees. Agent-to-agent coordination remains available through explicit `allowed_subagents`, result retrieval, steering, and stopping.

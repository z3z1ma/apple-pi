# Interactive subagents

The `Agent` tool launches named agent *types* in foreground or background. `get_subagent_result` waits for or inspects background work, `steer_subagent` redirects a running agent after its current tool, and `stop_subagent` terminates queued or running work. `/agents` lists the live roster and discovered types. In TUI mode, active work appears in the above-editor widget and the navigable below-editor FleetView; the conversation viewer supports live scrolling, steering, and explicit stopping.

`Agent` and `pi_exec` `agents.run` share the type catalog and serve different jobs. Use `Agent` for collaboration: background specialists, FleetView, steer/stop, resume, and a durable child session. Use `pi_exec` for composition: a program graph that fans out typed workers, binds MCP or tool results as `context`, and reduces to a compact value. The interactive `Agent`, result, steer, and stop tools are not exposed through Pi Exec's generic extension bridge; programs use the runtime-owned `agent()` / `agents.run()` lifecycle instead. [`/btw`](btw.md) is the small human-facing exception: one hidden, ephemeral, read-only child conversation that reuses the same manager with a focused answer-first overlay, without joining the public agent roster. The root prompt uses separate `<subagent-team>` and `<inference-profiles>` blocks. The first lists every enabled callable definition with its `name`, configured inference `profile`, and own `description`; the second lists each fixed inference profile with a short description of its intended model and reasoning characteristics. Inference profiles select inference policy, not capabilities.

Built-in types:

| Type | Lane | Default tools |
| --- | --- | --- |
| `Explore` | Local recon: where is X? | read-only |
| `Research` | External docs via MCP and cited sources; not local recon | read-only |
| `Plan` | How-to-implement across modules | read-only |
| `Counsel` | Should we / root cause / YAGNI. Not Advisor, not review | read-only |
| `Implement` | Bounded specified writes. No research, no UI taste | write |
| `Design` | User-visible layout, interaction, polish | write |

One isolated, known-path, low-risk action stays in the parent. If no specialist lane fits, keep the work in the parent session rather than delegating to an ambiguous catch-all. Treat every dispatch as a potentially large model/context expense: prefer one complete handoff, let the parent validate and fix ordinary issues, and conclude nits in the parent. Review and Ralph remain explicitly chosen program-specific workers with `systemPrompt` values and must not be retargeted onto catalog types. Unknown, disabled, missing, and ambiguous agent types always fail closed; dispatch never substitutes a different agent.

## Definitions

Agent definitions are Markdown with YAML frontmatter, discovered in this order. The package no longer provides a `general-purpose` built-in, but the name is not reserved: a Markdown definition may still create an ordinary custom agent with that name. Built-ins and global user agents remain available in every project; `.pi/agents` and `.agents/agents` are loaded only after the project is trusted.

1. `.pi/agents/*.md`
2. `.agents/agents/*.md`
3. `$PI_CODING_AGENT_DIR/agents/*.md` (normally `~/.pi/agent/agents/*.md`)

```markdown
---
name: reviewer
description: Reviews changes for correctness and missing evidence
profile: deep
tools: read, grep, find, bash
skills: true
advisor: false
max_turns: 30
allowed_subagents: scout
---

Review the requested change. Report concrete findings with file paths and evidence.
```

Trusted agent definitions and settings control tool scope, skills, model-profile selection, Advisor defaults, turn limits with graceful wrap-up, session persistence, and explicit nested-agent allowlists. A new top-level or nested `Agent` call selects a team member with `subagent_type`, may select an inference profile with `profile`, and may append dynamic guidance with `system_prompt`. The guidance is appended after the selected definition and preloaded skills, so it specializes the run without replacing the definition or granting capabilities. `pi_exec` `agents.run` provides the equivalent `type`, `profile`, and `systemPrompt` combination. Interactive children do not discover package extensions. Ordinary `Agent` children load the proactive overflow guard, ledger, `session_search`, and MCP via `--no-extensions` plus `-e`; `advisor: true` also loads the Advisor sidecar for correctness-critical implementation. The internal BTW child loads only the mandatory overflow guard. Agent-definition `extensions:` is ignored. Each `Agent` invocation explicitly chooses `inherit_context`, `false` by default: without inherited context, the task prompt is the complete handoff; setting `inherit_context: true` prepends the full parent conversation. Implement enables Advisor by default; use `advisor: false` in the invocation or definition to explicitly opt out. Other types use their agent-definition Advisor default. `max_turns` is a trusted definition-level run-length cutoff, not a model-facing output-size budget: omit it for an unlimited investigation. A turn-limited agent receives a comprehensive wrap-up instruction and retains the model's normal per-response output allowance; settled `get_subagent_result` calls return that final response in full. Nested children are ownership-scoped and depth-limited; they can be inspected, steered, or stopped only by the agent that launched them.

## Model profiles

Agent definitions select a semantic workload profile rather than naming a provider, model, or thinking level. Built-ins use `quick` for Explore and Research, `deep` for Plan and Counsel, `coding` for Implement, and `visual-engineering` for Design. The user maps those names in global `~/.pi/agent/model-profiles.json`; repositories cannot redefine the mapping.

The optional `profile` argument on top-level and nested `Agent` calls overrides the type's default as one model/thinking bundle. It never changes the type's prompt, tools, permissions, skills, or lifecycle. A missing, invalid, or unavailable selected profile fails the spawn instead of substituting the parent or another provider. A custom Markdown agent may omit `profile` to inherit the parent session's model/thinking.

See [Model profiles](model-profiles.md) for the exact file schema and standard workload names.

## Persistence and check-in

Top-level subagents persist as normal Pi child-session JSONL by default. The child loads standalone `session_search`. A long child run uses Pi default compaction unless the child is given the xAI compaction extension; it does not load observational memory or `memory_source`. There is no plugin-specific memory directory and no duplicate `.output` transcript. Set `persist_session: false` only when a definition should be ephemeral. Operational defaults can be overridden globally or, for trusted projects, in `.pi/subagents.json`; untrusted project settings are ignored while global user settings remain active. Retained settings are `maxConcurrent`, `defaultMaxTurns`, `graceTurns`, `defaultJoinMode`, `strictAgentFiles`, `disableDefaultAgents`, `fleetView`, `persistAgentSessions`, `widgetMode`, and `maxSubagentDepth`.

A foreground result includes its agent ID. A background launch or resume also tells the caller to pass that ID to `get_subagent_result`, which waits for and returns the final response by default. Pass that ID back through the `Agent` tool's `resume` parameter to continue the same `AgentSession`, including its prior conversation and compactions; profile, `system_prompt`, context inheritance, isolation, and Advisor choices are fixed when that session starts. `steer_subagent` and `stop_subagent` remain limited to agents that are currently running or queued. An ordinary `get_subagent_result` call waits until the child settles when `yield_seconds` is omitted, and the caller can still interrupt that wait without stopping the child. `yield_seconds` is deliberately a yield interval, not an agent timeout: the call returns immediately when the child settles, so omit it or use a very large positive value (normally 3,600 seconds or more) whenever a wait is desired. Set `yield_seconds` to `0` only for an immediate check. Reaching a positive yield interval returns the live status but leaves the queued or running child working; it neither stops nor consumes the child. Use `transcript_tail` to inspect up to 12,000 characters from the latest 1–20 child conversation messages, including current streaming output; omitting `yield_seconds` on a transcript snapshot keeps that inspection immediate, and a positive yield remains incompatible with transcript snapshots. Ownership-scoped nested agents expose the same check-in surface. Continuation is currently in-process: completed records are retired after about ten minutes, and a parent-session reload, switch, or shutdown does not rehydrate them from the persisted child JSONL.

The imported implementation deliberately has **no worktree parameter or worktree code**, **no scheduled agents**, **no human `@agent` input interception**, **no plugin-local agent memory**, and **no duplicate output-transcript store**. Agents can still use ordinary `bash` when they intentionally need Git or worktrees. Agent-to-agent coordination remains available through explicit `allowed_subagents`, result retrieval, steering, and stopping.

## To-do execution

An agent-backed [to-do](todos.md) uses the same catalog-level managed-subagent service as `Agent`, not an external extension, RPC, process tracker, or hidden controller worker. The service resolves the enabled agent type, optional profile, model/settings, Advisor policy, tool scope, queueing, persistence, and lifecycle. Each run is an ordinary public `AgentRecord`, visible in `/agents` and FleetView and stopped through the same `AgentManager`. The to-do layer stores only its run identity and bounded result/error, conditionally settling when the matching run completes; it never creates a second transcript or agent runtime.

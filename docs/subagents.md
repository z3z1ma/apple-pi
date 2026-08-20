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

One isolated, known-path, low-risk action stays in the parent. If no specialist lane fits, keep the work in the parent session rather than delegating to an ambiguous catch-all. Review and Ralph keep program-only `systemPrompt` roles and must not be retargeted onto these catalog types. Unknown, disabled, missing, and ambiguous agent types always fail closed; dispatch never substitutes a different agent.

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

Trusted agent definitions and settings control tool scope, skills, model-profile selection, Advisor defaults, turn limits with graceful wrap-up, session persistence, and explicit nested-agent allowlists. Interactive children do not discover package extensions. They load ledger, `session_search`, and MCP via `--no-extensions` plus `-e`; `advisor: true` also loads the Advisor sidecar for correctness-critical implementation. Agent-definition `extensions:` is ignored. Each `Agent` invocation explicitly chooses `inherit_context`, `false` by default: without inherited context, the task prompt is the complete handoff; setting `inherit_context: true` prepends the full parent conversation. Omit the invocation's `advisor` value to use the agent definition; an explicit boolean overrides it for that new session. Built-in `Implement` defaults Advisor on, while the other built-ins default it off. `max_turns` is a trusted definition-level run-length cutoff, not a model-facing output-size budget: omit it for an unlimited investigation. A turn-limited agent receives a comprehensive wrap-up instruction and retains the model's normal per-response output allowance; settled `get_subagent_result` calls return that final response in full. Nested children are ownership-scoped and depth-limited; they can be inspected, steered, or stopped only by the agent that launched them.

## Model profiles

Agent definitions select a semantic workload profile rather than naming a provider, model, or thinking level. Built-ins use `quick` for Explore and Research, `deep` for Plan and Counsel, `coding` for Implement, and `visual-engineering` for Design. The user maps those names in global `~/.pi/agent/model-profiles.json`; repositories cannot redefine the mapping.

The optional `profile` argument on top-level and nested `Agent` calls overrides the type's default as one model/thinking bundle. It never changes the type's prompt, tools, permissions, skills, or lifecycle. A missing, invalid, or unavailable selected profile fails the spawn instead of substituting the parent or another provider. A custom Markdown agent may omit `profile` to inherit the parent session's model/thinking.

See [Model profiles](model-profiles.md) for the exact file schema and standard workload names.

## Persistence and check-in

Top-level subagents persist as normal Pi child-session JSONL by default. The child loads standalone `session_search`. A long child run uses Pi default compaction unless the child is given the xAI compaction extension; it does not load observational memory or `memory_source`. There is no plugin-specific memory directory and no duplicate `.output` transcript. Set `persist_session: false` only when a definition should be ephemeral. Operational defaults can be overridden globally or, for trusted projects, in `.pi/subagents.json`; untrusted project settings are ignored while global user settings remain active. Retained settings are `maxConcurrent`, `defaultMaxTurns`, `graceTurns`, `defaultJoinMode`, `strictAgentFiles`, `disableDefaultAgents`, `fleetView`, `persistAgentSessions`, `widgetMode`, and `maxSubagentDepth`.

A foreground result includes its agent ID. Pass that ID back through the `Agent` tool's `resume` parameter to continue the same `AgentSession`, including its prior conversation and compactions; `steer_subagent` and `stop_subagent` remain limited to agents that are currently running or queued. `get_subagent_result` waits up to five minutes by default. `wait_seconds` may explicitly choose a 0–300 second wait; `0` checks immediately, and an expired wait returns the live status without stopping the child so the parent can inspect, steer, or work in parallel. Use `transcript_tail` to inspect up to 12,000 characters from the latest 1–20 child conversation messages, including current streaming output; omitting `wait_seconds` on a transcript snapshot keeps that inspection immediate. Ownership-scoped nested agents expose the same check-in surface. Continuation is currently in-process: completed records are retired after about ten minutes, and a parent-session reload, switch, or shutdown does not rehydrate them from the persisted child JSONL.

The imported implementation deliberately has **no worktree parameter or worktree code**, **no scheduled agents**, **no human `@agent` input interception**, **no plugin-local agent memory**, and **no duplicate output-transcript store**. Agents can still use ordinary `bash` when they intentionally need Git or worktrees. Agent-to-agent coordination remains available through explicit `allowed_subagents`, result retrieval, steering, and stopping.

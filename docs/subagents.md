# Engineering team

The `agent` tool brings a named teammate into a foreground or background Pi session. `get_subagent_result` waits for or checks background work, `steer_subagent` gives a running teammate more guidance after their current tool, and `stop_subagent` ends queued or running work. `/agents` lists the live roster and discovered types. In TUI mode, active work appears in the above-editor widget and the navigable below-editor FleetView; the conversation viewer supports live scrolling, steering, and explicit stopping.

`agent` and `pi_exec` `agent.run` share the same team catalog but support different kinds of collaboration. Use `agent` when a teammate should own a piece of work with their own session, context, and ability to check back in. Use `pi_exec` when model workers belong inside a program graph that fans out, binds MCP or tool results as `context`, and reduces to a compact value. The interactive `agent`, result, steer, and stop tools are not exposed through Pi Exec's generic extension bridge; programs use the runtime-owned `agent()` / `agent.run()` lifecycle instead. [`/btw`](btw.md) is the small human-facing exception: one hidden, ephemeral, read-only child conversation that reuses the same manager with a focused answer-first overlay, without joining the public team roster. The root prompt uses separate `<subagent-team>` and `<inference-profiles>` blocks. The first introduces every available teammate with their `name`, configured inference `profile`, and own `description`; the second lists each fixed inference profile with a short description of its intended model and reasoning characteristics. Inference profiles select inference policy, not capabilities.

Built-in types:

| Type | Lane | Default tools |
| --- | --- | --- |
| `explorer` | Local recon: where is X? | `read`, `grep`, `find`, `ls`, `search_session` |
| `planner` | How-to-implement across modules | `read`, `grep`, `find`, `ls`, `search_session` |
| `researcher` | External docs from supplied/bound sources; not local recon | `read`, `grep`, `find`, `ls`, `search_session` |
| `consultant` | Should we / root cause / YAGNI. Not the pair programmer, not review | `read`, `grep`, `find`, `ls`, `search_session` |
| `builder` | Bounded specified writes. No research, no UI taste | write |
| `designer` | User-visible layout, interaction, polish | write |

Use the team when another perspective, specialist skill, isolated context, or parallel lane would materially help. One small, known-path action usually stays in the main session, and work without a fitting teammate should not be forced into an ambiguous catch-all. Give a teammate one clear outcome and enough context to own it, then let the main session inspect, integrate, and fix ordinary issues. Review and Ralph remain explicitly chosen program-specific workers with `systemPrompt` values and must not be retargeted onto catalog types. Unknown, disabled, missing, and ambiguous agent types always fail closed; dispatch never substitutes a different teammate.

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
pair: false
max_turns: 30
allowed_subagents: scout
---

Review the requested change. Report concrete findings with file paths and evidence.
```

Trusted agent definitions and settings control tool scope, skills, model-profile selection, pair programmer defaults, turn limits with graceful wrap-up, session persistence, and explicit nested-agent allowlists. A new top-level or nested `agent` call selects a team member with `subagent_type`, may select an inference profile with `profile`, and may append dynamic guidance with `system_prompt`. The guidance is appended after the selected definition and preloaded skills, so it specializes the run without replacing the definition or granting capabilities. `pi_exec` `agent.run` provides the equivalent `type`, `profile`, and `systemPrompt` combination. Interactive children do not discover package extensions. Write-capable ordinary `agent` children load vroom (fast mode), automatic-compaction safety/fallback, the [search root guard](home-search-guard.md), ledger, `search_session`, and MCP via `--no-extensions` plus `-e`; `pair: true` also loads the pair programmer sidecar for correctness-critical implementation. The four built-in read-only roles receive no shell, mutation-capable ledger, MCP, or pair programmer surface; they load only vroom (fast mode), both safety guards, and `search_session`. The internal BTW child loads only vroom (fast mode) and the mandatory safety guards. Agent-definition `extensions:` is ignored. The builder works with a pair programming partner by default; use `pair: false` in the invocation or definition to explicitly opt out. Other types use their agent-definition pair programmer default. `max_turns` is a trusted definition-level run-length cutoff, not a model-facing output-size budget: omit it for an unlimited investigation. The same ceiling applies to every continuation of the session. A turn-limited agent receives a comprehensive wrap-up instruction and retains the model's normal per-response output allowance; settled `get_subagent_result` calls return that final response in full. Nested children are ownership-scoped and depth-limited; they can be inspected, steered, or stopped only by the agent that launched them.

### Context inheritance

A root `agent` call is a normal sub-agent handoff. Its prompt is the complete task by default. Set `inherit_context: true` only when the child also needs the full parent conversation.

The consultant follows this same public contract when the main agent brings the architect in directly. The pair programming partner's hidden typed second-opinion path is an internal host operation, not an `agent` mode or parameter.

## Model profiles

Agent definitions select a semantic workload profile rather than naming a provider, model, or thinking level. Built-ins use `quick` for the explorer and researcher, `deep` for the planner and consultant, `coding` for the builder, and `visual-engineering` for the designer. The user maps those names in global `~/.pi/agent/model-profiles.json`; repositories cannot redefine the mapping.

The optional `profile` argument on top-level and nested `agent` calls overrides the type's default as one model/thinking bundle. It never changes the type's prompt, tools, permissions, skills, or lifecycle. A missing, invalid, or unavailable selected profile fails the spawn instead of substituting the parent or another provider. A custom Markdown agent may omit `profile` to inherit the parent session's model/thinking.

See [Model profiles](model-profiles.md) for the exact file schema and standard workload names.

## Persistence and check-in

Top-level subagents persist as normal Pi child-session JSONL by default. The child loads standalone `search_session`. A long child run uses Pi default compaction unless the child is given the xAI compaction extension; it does not load pair programmer notebook or `revisit_note`. There is no plugin-specific memory directory and no duplicate `.output` transcript. Set `persist_session: false` only when a definition should be ephemeral. Operational defaults can be overridden globally or, for trusted projects, in `.pi/subagents.json`; untrusted project settings are ignored while global user settings remain active. Retained settings are `maxConcurrent`, `defaultMaxTurns`, `graceTurns`, `defaultJoinMode`, `strictAgentFiles`, `disableDefaultAgents`, `fleetView`, `persistAgentSessions`, `widgetMode`, and `maxSubagentDepth`.

A foreground result includes its agent ID. A background launch or resume also tells the caller to pass that ID to `get_subagent_result`, which waits for and returns the final response by default. The root `agent` tool's optional `output_path` writes that invocation's final response verbatim through the host, creates missing parent directories, and replaces any existing file. Relative paths resolve from the root session's working directory. After a successful write, foreground results, background notifications, and `get_subagent_result` report the path instead of copying the response into the parent transcript. The option applies independently to initial and resumed invocations; a write failure is reported as an error with the response inline so the output is not lost. Pass the agent ID back through the `agent` tool's `resume` parameter to continue the same `AgentSession`, including its prior conversation and compactions; profile, `system_prompt`, context inheritance, isolation, and pair programmer choices are fixed when that session starts. `steer_subagent` and `stop_subagent` remain limited to agents that are currently running or queued. An ordinary `get_subagent_result` call waits until the child settles when `yield_seconds` is omitted, and the caller can still interrupt that wait without stopping the child. `yield_seconds` is deliberately a yield interval, not an agent timeout: the call returns immediately when the child settles, so omit it or use a very large positive value (normally 3,600 seconds or more) whenever a wait is desired. Set `yield_seconds` to `0` only for an immediate check. Reaching a positive yield interval returns the live status but leaves the queued or running child working; it neither stops nor consumes the child. Use `transcript_tail` to inspect up to 12,000 characters from the latest 1–20 child conversation messages, including current streaming output; omitting `yield_seconds` on a transcript snapshot keeps that inspection immediate, and a positive yield remains incompatible with transcript snapshots. Ownership-scoped nested agents expose the same check-in surface. Continuation is currently in-process: completed records are retired after about ten minutes, and a parent-session reload, switch, or shutdown does not rehydrate them from the persisted child JSONL.

The imported implementation deliberately has **no worktree parameter or worktree code**, **no scheduled agents**, **no human `@agent` input interception**, **no plugin-local agent memory**, and **no duplicate output-transcript store**. Agents can still use ordinary `bash` when they intentionally need Git or worktrees. Agent-to-agent coordination remains available through explicit `allowed_subagents`, result retrieval, steering, and stopping.

# Engineering team

The `agent` tool brings a named teammate into a foreground or background Pi session. `get_subagent_result` waits for or checks background work, `steer_subagent` gives a running teammate more guidance after their current tool, and `stop_subagent` ends queued or running work. `/work` opens the work panel with Agents, Tasks, and Pi Exec tabs on its last-used tab; `Ctrl+W` toggles it open or closed; `/agents` opens the same panel directly on the Agents tab. `Ctrl+W` intentionally replaces Pi's default delete-word-backward editor shortcut. In TUI mode, running and queued public agents appear in the shared passive above-editor active-work widget, and the input card shows a terse non-zero `agents:N` count. Every unconsumed public-background terminal outcome, including an operator stop from the work panel, sends one XML notification through `deliverAs: "steer"`; foreground and explicitly consumed outcomes already return inline and do not duplicate that message. Nested and internal outcomes remain with their owner. Terminal outcomes leave the passive surface.

### Work panel

The work panel is one glanceable overlay shared by agents, [tasks](tasks.md), and [Pi Exec programs](exec.md#work-panel-inspection). `/work`, `/agents`, and `/tasks` open it directly, with no picker or pin step; repeating those commands while it is open reuses the same panel and only selects the tab. `Ctrl+W` toggles the panel closed or reopens it on the last-used tab with its saved selection. It never opens by itself and does not take keyboard focus, so you keep typing to the main agent. It stays open when no agent is running, and a modal can open above it and close without removing it.

Placement follows the terminal width. At 120 columns or more the panel sits at the top right, one third of the width and at most 70% of the height. On narrower terminals it drops down from the top center like [`/btw`](btw.md), 90% of the width and at most half the height; it never hides because of width. Resizing keeps the same panel, so the tab, selected agent, task, or program, scroll position, follow-tail state, and any steering draft survive in both directions.

`Alt+G` moves keyboard focus into the panel; `Alt+G` again or `Esc` returns it to the editor with your draft unchanged. With focus, these keys apply on every tab while no steering message is being composed:

| Key | Action |
| --- | --- |
| `←` / `→` | Switch between the Agents, Tasks, and Pi Exec tabs |
| `Esc` or `Alt+G` | Return focus to the editor |
| `q` | Close the panel |

In fullscreen mode, a left click on the panel focuses it, a click on a tab label selects that tab, and the mouse wheel scrolls the active tab's conversation, task detail, or program detail, focused or not. Closing and reopening the panel returns to the last tab and each tab's selected record for the life of the Pi process; this state is never written to the session. Session shutdown closes the panel.

### Agents tab

The Agents tab lists the session's public agents, running and finished, with each agent's status, current activity, turns, tool uses, tokens, and duration, and shows the selected agent's live conversation below the list. Nested and internally owned agents are excluded. With focus:

| Key | Action |
| --- | --- |
| `Tab` / `Shift+Tab` | Select the next or previous agent |
| Configured scroll keys, `k`/`j`, page keys, `Home`/`End` | Scroll the selected conversation |
| `Enter` | Compose a steering message for a running or queued agent; `Enter` sends, `Esc` cancels |
| `x` twice | Stop the selected running or queued agent |
| `t` | Switch between the roster and the discovered agent types |

While a steering message is being composed, every key, including arrows, `Tab`, and `q`, goes to the message. A pending stop confirmation is dropped when focus leaves the panel, the tab changes, or another agent is selected. Settled conversations remain readable without steer or stop actions.

`agent` and `pi_exec` `agent_run` share the same team catalog but support different kinds of collaboration. Use `agent` when a teammate should own a piece of work with their own session, context, and ability to check back in. Use `pi_exec` when model workers belong inside a program graph that fans out, binds MCP or tool results as `context`, and reduces to a compact value. The interactive `agent`, result, steer, and stop tools are not exposed through Pi Exec's generic extension bridge; programs use the runtime-owned `agent()` / `agent_run()` lifecycle instead. [`/btw`](btw.md) is the small human-facing exception: one hidden, ephemeral, read-only child conversation that reuses the same manager with a focused answer-first overlay, without joining the public team roster. The root prompt uses separate `<subagent-team>` and `<inference-profiles>` blocks. The first introduces every available teammate with their `name`, configured inference `profile`, and own `description`; the second lists each fixed inference profile with a one-line description of its intended model and reasoning effort. Inference profiles select inference policy, not capabilities.

Built-in types:

| Type | Lane | Default tools |
| --- | --- | --- |
| `explorer` | Local recon: where is X? | All built-ins except `edit` and `write`; ordinary child extensions |
| `planner` | How-to-implement across modules | All built-ins except `edit` and `write`; ordinary child extensions |
| `researcher` | External docs and primary sources; not local recon | All built-ins except `edit` and `write`; ordinary child extensions |
| `consultant` | Should we / root cause / YAGNI. Not the pair programmer, not review | All built-ins except `edit` and `write`; ordinary child extensions |
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

Trusted agent definitions and settings control tool scope, skills, model-profile selection, pair programmer defaults, turn limits with graceful wrap-up, session persistence, and explicit nested-agent allowlists. A new top-level or nested `agent` call selects a team member with `subagent_type`, may select an inference profile with `profile`, and may append dynamic guidance with `system_prompt`. The guidance is appended after the selected definition and preloaded skills, so it specializes the run without replacing the definition or granting capabilities. `pi_exec` `agent_run` provides the equivalent `type`, `profile`, and `system_prompt` combination. Interactive children do not discover package extensions. Ordinary `agent` children, including the four non-implementing built-ins, load vroom (fast mode), automatic-compaction failure safety, the [search root guard](home-search-guard.md), ledger, wiki, `search_session`, and RTK via explicit extension paths with discovery disabled, plus Pi's native MCP and tool-search SDK factories (not codemode); `pair: true` also loads the pair programmer sidecar. The four advisory roles omit only the built-in `edit` and `write` tools. Their instruction to leave files and external resources unchanged is prompt guidance, not an execution sandbox: shell and extension tools can mutate state. The internal BTW child loads only vroom (fast mode) and the mandatory safety guards. Agent-definition `extensions:` is ignored. Each child prompt starts with its role definition and then carries `<tools>` and `<rules>` sections built from the tools that child actually has, plus the sections its loaded extensions add. The builder works with a pair programming partner by default; use `pair: false` in the invocation or definition to explicitly opt out. Other types use their agent-definition pair programmer default. `max_turns` is a trusted definition-level run-length cutoff, not a model-facing output-size budget: omit it for an unlimited investigation. The same ceiling applies to every continuation of the session. A turn-limited agent receives a comprehensive wrap-up instruction and retains the model's normal per-response output allowance; settled `get_subagent_result` calls return that final response in full. Nested children are ownership-scoped and depth-limited; they can be inspected, steered, or stopped only by the agent that launched them.

### Context inheritance

A root `agent` call is a normal sub-agent handoff. Its prompt is the complete task by default. For a new root or nested session, `run_in_background`, `isolated`, and `inherit_context` each default to `false`. Set `inherit_context: true` only when the child also needs the full parent conversation. On resume, omitted `isolated` and `inherit_context` reuse the session's stored choices; `run_in_background` remains a per-invocation choice and defaults to `false`.

The consultant follows this same public contract when the main agent brings the architect in directly. The pair programming partner's hidden typed second-opinion path is an internal host operation, not an `agent` mode or parameter.

### Child clarification

Every session launched through the public `agent` tool receives `clarify({ question })`, including advisory roles, isolated sessions, and ownership-scoped nested children. A trusted definition can exclude it through `disallowed_tools`. It remains available on resume. Root sessions, Pi Exec workers, BTW, and internal consultations do not receive this tool. Clarification forks retain their parent's tool declarations for caching, but cannot execute `clarify`.

Each tool invocation forks the **immediate parent's latest active conversation** through `startFork` in `components/shared/src/forked-continuation.ts`. The immediate parent is the session that launched the child; for a nested child, it is another subagent rather than the root session. The fork retains the parent's system prompt, model, thinking level, tool declarations, provider session ID (cache key), and request hooks. The clarification frame and question are appended after the parent's conversation, preserving its cached prefix. It neither waits for nor interrupts the parent, and bypasses the background-agent pool so a child can ask while that pool is full. Calls remain independent: each gets a fresh snapshot rather than continuing an earlier clarification conversation. If the live parent is unavailable, the call fails instead of rebuilding a substitute session.

The snapshot preserves the active Pi projection, including compaction summaries, images, and tool results. Unfinished parent tool calls receive explicit unavailable-result placeholders appended at the end; the fork does not execute them. The parent's tool declarations stay intact for caching, but execution permits only `read`, `grep`, `find`, and `ls` from that loadout. All other tools, including delegation and further clarification, are blocked before the parent's tool hooks run. Allowed tools and provider requests use the shared fork's parent hooks and services, with the same limits as other [forked continuations](forked-continuations.md#limits). The fork reads current repository files, not a filesystem snapshot. The child should include relevant findings or alternatives in its question because its own private conversation is not copied.

The answer returns only to the calling child as tool output. It is advice based on existing intent, not new user authorization or a message from the live parent. Questions requiring a new user decision remain unresolved. The in-memory fork is released after success, failure, or cancellation; stopping the child or shutting down its owning session also cancels an active clarification. Successful clarification results carry their model usage into the child's session accounting, without also recording that usage in the parent. No separate fork transcript is persisted, though the question and answer remain in the child's normal tool history.

## Model profiles

Agent definitions select a semantic workload profile rather than naming a provider, model, or thinking level. Built-ins use `quick` for the explorer and researcher, `deep` for the planner and consultant, `coding` for the builder, and `visual-engineering` for the designer. The user maps those names in global `~/.pi/agent/model-profiles.json`; repositories cannot redefine the mapping.

The optional `profile` argument on top-level and nested `agent` calls overrides the type's default as one model/thinking bundle. It never changes the type's prompt, tools, permissions, skills, or lifecycle. A missing, invalid, or unavailable selected profile fails the spawn instead of substituting the parent or another provider. A custom Markdown agent may omit `profile` to inherit the parent session's model/thinking.

See [Model profiles](model-profiles.md) for the exact file schema and standard workload names.

## Persistence and check-in

Top-level subagents persist as normal Pi child-session JSONL by default. The child loads standalone `search_session`. A long child run uses Pi default compaction, because children do not load the server-side compaction extension; it does not load pair programmer notebook or `revisit_note`. There is no plugin-specific memory directory and no duplicate `.output` transcript. Set `persist_session: false` only when a definition should be ephemeral. Operational defaults can be overridden globally or, for trusted projects, in `.pi/subagents.json`; untrusted project settings are ignored while global user settings remain active. Retained settings are `maxConcurrent`, `defaultMaxTurns`, `graceTurns`, `defaultJoinMode`, `strictAgentFiles`, `disableDefaultAgents`, `persistAgentSessions`, and `maxSubagentDepth`.

A foreground result includes its agent ID. Foreground results, background notifications, and settled `get_subagent_result` calls also list the files that invocation touched through `edit` and `write`: edit `+added -removed` lines counted from each patch, the line count of the latest write with `created` or `overwrote`, and failed calls. The list starts fresh on each resume. Changes made through shell, MCP, or nested agents are not traced. Pressing `Esc` during a foreground launch or clarification releases the tool call and stops that child, including while it is still starting. A background launch or resume also tells the caller to pass that ID to `get_subagent_result`, which waits for and returns the final response by default. The root `agent` tool's optional `output_path` writes that invocation's final response verbatim through the host, creates missing parent directories, and replaces any existing file. Relative paths resolve from the root session's working directory. After a successful write, foreground results, background notifications, and `get_subagent_result` report the path instead of copying the response into the parent transcript. The option applies independently to initial and resumed invocations; a write failure is reported as an error with the response inline so the output is not lost.

### Resume a teammate

Pass the agent ID back through the `agent` tool's `resume` parameter to continue the same `AgentSession`, including its prior conversation and compactions; profile, `system_prompt`, context inheritance, isolation, and pair programmer choices are fixed when that session starts. For both root and nested resumes, omit `profile`, `system_prompt`, `inherit_context`, `isolated`, and `pair` to reuse the stored choices. Explicit matching values are accepted; explicit changes, including `false` when the stored boolean is `true`, are rejected before continuation. Start a new session to use different fixed settings. A supplied `system_prompt` is trimmed before comparison, and whitespace-only guidance retains the stored prompt. `run_in_background` can change on each invocation without changing those fixed choices.

### Check in on a teammate

`steer_subagent` and `stop_subagent` remain limited to agents that are currently running or queued. An ordinary `get_subagent_result` call waits until the child settles when `yield_seconds` is omitted, and the caller can still interrupt that wait without stopping the child. `yield_seconds` is deliberately a yield interval, not an agent timeout: the call returns immediately when the child settles, so omit it or use a very large positive value (normally 3,600 seconds or more) whenever a wait is desired. Set `yield_seconds` to `0` only for an immediate check. Reaching a positive yield interval returns the live status but leaves the queued or running child working; it neither stops nor consumes the child. Use `transcript_tail` to inspect up to 12,000 characters from the latest 1–20 child conversation messages, including current streaming output; omitting `yield_seconds` on a transcript snapshot keeps that inspection immediate, and a positive yield remains incompatible with transcript snapshots. Ownership-scoped nested agents expose the same check-in surface. Continuation is currently in-process: completed public agents stay until the parent session reloads, switches, or shuts down, completed nested and internal records retire after about ten minutes, an unread public result carried into the next session also retires after about ten minutes, and nothing is rehydrated from the persisted child JSONL.

The imported implementation deliberately has **no worktree parameter or worktree code**, **no scheduled agents**, **no human `@agent` input interception**, **no plugin-local agent memory**, and **no duplicate output-transcript store**. Agents can still use ordinary `bash` when they intentionally need Git or worktrees. Agent-to-agent coordination remains available through explicit `allowed_subagents`, result retrieval, steering, and stopping.

# 14: The workplace documented

**Context:** [spec.md](../spec.md) defines the terms used here (person, operator, runtime, thread, push and pull, ephemeral task, intern) and records the decisions this ticket implements.

**What to build:** The docs describe what exists: `docs/organization.md` (the workplace tools, threads, assignments, tasks), `docs/session-state.md` (threads, assignments, ephemeral tasks, the operator as a person, no child rows), `docs/agent-world.md`, an interns doc in place of `docs/subagents.md`, `docs/exec.md` (peers in programs), `docs/pair-programmer.md` (second opinions), `docs/boundaries.md` (rejected: custom agents, background subagents, pushed channels, assignment tickets beyond tasks, calendars), AGENTS.md (execution contexts and architecture map), and the README catalog.

**Blocked by:** 11 Subagents removed, 12 Workplace extras, 13 Agent World shows the workplace

**Status:** done

- [x] No doc, AGENTS.md line, or README line names a removed tool, the subagent team, custom agents, or senses.
- [x] Each new tool is described in the doc that owns its area.
- [x] `docs/boundaries.md` lists the rejected ideas with their reasons.
- [x] `wiki_lint` and `context_lint` pass.

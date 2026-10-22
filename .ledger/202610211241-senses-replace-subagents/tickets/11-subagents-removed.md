# 11: Subagents removed

**Context:** [spec.md](../spec.md) defines the terms used here (person, operator, runtime, thread, push and pull, ephemeral task, intern) and records the decisions this ticket implements.

**What to build:** The subagent system is deleted: the `agent`, `get_subagent_result`, `steer_subagent`, and `stop_subagent` tools; the `<subagent-team>` section; the manager, in-process runner, background lane, group join, nesting, and `clarify`; custom agent loading and settings (and the operator's `~/.pi/agent/agents/grafana-debugger.md`); coding children's completion review and notebook access; the Agents tab, the active-agent widget and count, and the conversation viewer; child rows in the runtime. `/btw` keeps its behavior and owns its one session directly. `inChildSessionContext` checks go wherever no in-process child remains. Skills that fan out `agent` sessions are rewritten to use interns, peers, or `pi_exec`.

**Blocked by:** 08 Interns, 09 The pair asks the organization, 10 `pi_exec` on peers

**Status:** in-progress

**Scope change approved during 11:** The operator approved deleting `optional-extensions/` and its related tests. Remove the Todos and Backlog implementations, packaging and validation entries, and documentation. This supersedes the earlier plan to migrate Todos from the managed background service to peers; that dependency disappears with its consumer.

- [ ] The package-load test shows none of the four subagent tools and no `<subagent-team>` section, with `explore` and `research` present.
- [x] `/btw` opens, answers, takes a follow-up, and is dismissed as before (its existing tests pass against the new owner). Twenty-eight checks cover the preserved view and the directly owned SDK session, including startup/compaction cancellation and late cleanup; see [implementation notes](../implementation-11.md).
- [ ] The work panel has the Tasks and Pi Exec tabs only, and no active-agent widget appears.
- [ ] No session writes a `child` row to the runtime.
- [ ] No skill or prompt names a removed tool (a repository grep in the test suite).
- [ ] `grafana-debugger.md` is gone from the operator's agent directory.

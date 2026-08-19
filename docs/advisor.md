# Advisor

The advisor is a persistent read-only peer model. It reviews main-agent turns and sends sparse, severity-tagged advice. It is enabled unless explicitly disabled:

```text
/advisor status
/advisor off
/advisor on
```

It uses the `advisor` entry from a trusted project's `.pi/modes.json`, then global `~/.pi/agent/modes.json` when present. Otherwise it tries `openrouter/z-ai/glm-5.2`. An optional project `WATCHDOG.md` supplies advisor-only review guidance only when Pi trusts the project. While enabled, it appends a short protocol to the main agent's system prompt so nits, concerns, and blockers are treated as a peer review rather than optional commentary. Primary compaction leaves the advisor conversation in place. Session start, tree navigation, and handoff start a new advisor conversation seeded from the live curator fold, recent user messages, the last 8 implementing-agent turns as receipts, and rolling settled advice. Every primary turn is still queued as a trajectory projection — reasoning and tool intents stay; observation and command results become receipts with `call:<id>` addresses; successful writes omit file content — and the advisor model is called on a terminal turn, held high-severity advice, a mutation/error/command/user-text step, a user `!bash`, a backlog of 8, or after 15 seconds of deferred low-signal work. Besides `read`, `grep`, and `find`, it can call `memory_source` and `session_search` against the primary session, not its own conversation. `session_search` query `call:<id>` recovers an omitted tool-result body.

The advisor makes additional model calls. Its status and accumulated cost are visible through `/advisor status` and the footer. Each review prompt also appends a usage record under `~/.pi/agent/sidecar-usage/`; see [Sidecar usage records](context.md#sidecar-usage-records).

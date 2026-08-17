# Advisor

The advisor is a persistent read-only peer model. It reviews main-agent turns and sends sparse, severity-tagged advice. It is enabled unless explicitly disabled:

```text
/advisor status
/advisor off
/advisor on
```

It uses the `advisor` entry from a trusted project's `.pi/modes.json`, then global `~/.pi/agent/modes.json` when present. Otherwise it tries `openrouter/z-ai/glm-5.2`. An optional project `WATCHDOG.md` supplies advisor-only review guidance only when Pi trusts the project. While enabled, it appends a short protocol to the main agent's system prompt so nits, concerns, and blockers are treated as a peer review rather than optional commentary. After compaction, resume, fork, reload, or tree navigation, the advisor passively re-primes from Pi's active session context before reviewing new work.

The advisor makes additional model calls. Its status and accumulated cost are visible through `/advisor status` and the footer.

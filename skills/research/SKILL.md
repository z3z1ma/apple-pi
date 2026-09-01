---
name: research
description: Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent.
---

The built-in `researcher` teammate is read-only and has no general MCP or fetch capability. Before delegating an external question, the root agent must acquire the primary-source material with available root-level tools and supply or bind content the teammate can actually read. An unfetched URL alone is not readable evidence.

Spin up the `researcher` as a background `agent` session to do the research, so you keep working while it reads.

Its job:

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Return the findings to the root agent with a citation for each claim and enough source identity to revisit it.
3. If the required source material is unavailable, return an explicit **Not verified** result that names the missing evidence. Do not substitute memory for research.

The root agent's job:

1. Write the returned findings to a single Markdown file.
2. Save it where the repo already keeps such notes and match the existing convention. Otherwise use the active ledger task for bounded undertaking-specific research or load the `llm-wiki` skill for reusable supporting knowledge. If neither fits, put it somewhere sensible and say where.

When a question splits into genuinely independent research areas, it is acceptable to start multiple `researcher` sessions in parallel. Give each one a distinct scope and readable source material, start every background session before waiting for results, and reconcile their findings into the same single Markdown artifact. Do not split one search merely to create parallel work.

Use direct `agent` sessions for this flat delegation. Reach for `pi_exec` only when the research actually composes agents, tools, branching, or reduction into a graph.

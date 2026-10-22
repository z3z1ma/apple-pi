---
name: research
description: Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or external reading kept out of the main context.
---

Use the `research` tool to give a cheap intern a bounded external question. Name the relevant versions and primary sources, and supply source material when access depends on the root's integrations or credentials. The intern keeps reading out of the main context and returns once; its summary is lossy and can miss or misread details.

Ask it to:

1. Investigate against **primary sources**: official docs, source code, specs, and first-party APIs. Follow each claim to the source that owns it.
2. Return findings with citations and enough source identity to revisit each claim.
3. Mark missing evidence **Not verified**, and distinguish what it checked from what it believes.

The root verifies the details that decide the outcome against the cited sources, then writes the findings to one Markdown file. Match the repository's existing convention for such notes. Otherwise use the active ledger task for undertaking-specific research, or read and follow [`llm-wiki`](../llm-wiki/SKILL.md) for reusable knowledge. If neither fits, choose a sensible location and report it.

When the question has independent parts, call several research interns in parallel with distinct questions and readable material, then reconcile their answers into the same artifact. Use `pi_exec` when source acquisition, tool calls, and result reduction benefit from a program; ordinary parallel reading needs only the intern tools.

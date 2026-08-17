---
name: ledger-research-task
description: "Research a .ledger task and preserve a reproducible investigation record. Use when asked to investigate or verify a task assumption, compare authoritative sources, test a hypothesis, or capture versions, contradictions, null results, confidence, and limits before specification or planning. Not for deciding product semantics or implementing the task."
---

# Research a Ledger Task

Research reduces uncertainty; it does not silently decide product semantics or authorize implementation.

1. Read the owning `task.md`, existing task-local research, governing repository documentation, and relevant source.
2. State the exact question or falsifiable hypothesis and why its answer changes the task.
3. Use authoritative, current sources. Record source identity, version or revision, access date, method, and relevant null results. Redact secrets and personal data.
4. Separate observation from inference and recommendation.
5. Record contradictions and stale authority rather than selecting the convenient source.
6. End with conclusions, confidence, limits, and the decisions or spec changes the findings can support.

Write one focused record under `.ledger/<task>/research/`:

```markdown
Status: active | done | superseded
Created: YYYY-MM-DD
Updated: YYYY-MM-DD

# Research question

## Question Or Hypothesis
## Motivation
## Sources And Methods
## Findings
## Conclusions
## Limits
## Related Records
```

Store task-specific captured material under a clearly named `research/.storage/` child only when the record needs it and the material is safe to retain. Prefer durable links and compact excerpts over copied corpora.

Research may challenge an assumption, open a blocker, support a decision, or inform a spec. It never ratifies a semantic choice by itself. If a finding invalidates an Assumption or prevents safe planning or execution, update the corresponding Assumptions or Blockers entry. Link the result from the task or its governing task-local decision/spec, and update the Journal with the concrete implication.

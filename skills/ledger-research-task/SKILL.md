---
name: ledger-research-task
description: "Use when a ledger task needs an investigation whose sources, findings, null results, and limits must survive the session."
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

Research may challenge an assumption, open a blocker, support a decision, or inform a spec. It never ratifies a semantic choice by itself. Link the result from the task or a task-local decision/spec, and update the task Journal with the concrete implication.

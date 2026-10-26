Type: interrogation
Status: resolved
Blocked by: 01, 04

## Question

Which causal facts earn a place in the session-state runtime, given that `docs/boundaries.md` rejects a handoff schema and tickets beyond tasks? Candidates: a blocker (`waits on` a task, thread, or person), a decision request and its resolution, verification evidence, task-to-commit or PR links. Decide the minimal set, who writes each, and how inferred links carry provenance and confidence.

## Answer

Decided by the brief ([source.md](../source.md)); the operator directed on 2026-10-24 that the map follows it verbatim and that history data informs but does not gate. The runtime gains `WorkLink` edges between existing entities (tasks, sessions, threads, commits, PRs, verification runs) with the relations `blocks`, `produced`, `verifies`, `requires_decision`, `supersedes`, an evidence reference, `createdAt`, and `resolvedAt` (section 4). People record an edge when a consequential relationship exists; conversations stay conversational. Inferred edges carry provenance and confidence. Cost attribution records focus and work context at the execution boundary, with uncertainty explicit (section 9, Layer A). `docs/boundaries.md` must say that causal links are not the rejected handoff schema or tickets beyond tasks.

Physical form: the brief fixes the concept, not the machinery. The operator ruled on 2026-10-24 that the implementation is aggressively minimal and verification work is deferred; the form is settled in [Minimal physical form](18-minimal-physical-form.md).

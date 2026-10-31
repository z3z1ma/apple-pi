Status: in-progress
Created: 2026-10-31

# Implement semantic review queue and /reviews

## Intent

Implement the approved semantic risk-based review proposal from .ledger/history/202610301933-semantic-risk-based-code-review/proposal.md, incorporating the operator's explicit direction: replace /work with /reviews; make the review queue the only tab, with a master-detail interface and useful review status visible in the master list. Use ordinary reviewer peers/environments, not a custom sandbox. Deliver exact captured targets, behavior-based chunks, risk-directed independent passes and integration review, durable runtime-owned queue/recovery, truthful coverage/findings/freshness and artifact-bound sign-off, native tools and the Workplace Code surface per the approved plan. Preserve existing task and pi_exec execution capabilities while retiring their combined work-panel UI. Implement personally, preserve unrelated dirty work including post-review test/context changes, validate focused files with limited concurrency, build/package relevant surfaces, and report actual activation and effectiveness limits. Optional automatic commit enqueue and comparative experiments remain separately scoped per the approved proposal.

## Current state

Capture foundation implemented and checked; see [evidence](evidence.md). It retains source and intent, preserves the author's index, detects observed mutation, and supports ordinary Git inspection from a self-contained artifact. A measured per-blob subprocess bottleneck was replaced with Git batch acquisition. This is not yet a usable native review or the completed first delivery slice.

Next: runtime-owned jobs and attempts using the existing peer lifecycle, then semantic/risk/integration execution and the shared native/TUI/Workplace result surfaces. `/work` has not yet been removed, and `/reviews` is not yet available. No live activation or paid review turn has occurred.

## Acceptance

- Approved slices 1-3 work together: exact durable capture, semantic/risk/integration review, and the usable queue with exact-artifact approval.
- `/reviews` replaces the old combined panel with one review queue tab and a master-detail view; the master list shows meaningful status directly.
- Task and Pi Exec execution capabilities remain available independently of the removed UI.
- Focused tests cover lifecycle/recovery and real native/IPC entry paths; applicable UI builds and packaging are verified. Missing evidence stays explicit rather than being presented as completed coverage.
- Ordinary reviewer environments remain intact. Comparative quality and optional commit automation stay outside this implementation's completion claim.

## Outcome

Pending completion.

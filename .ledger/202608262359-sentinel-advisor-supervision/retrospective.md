Status: complete
Created: 2026-08-26
Updated: 2026-08-27

# Retrospective

## Summary

Delivered one hierarchy: main agent, optional persistent Sentinel, and episodic deep Advisor sub-agent.

## What Worked

- Reusing Sentinel trajectory receipts and the managed sub-agent service avoided a second runtime.
- Typed escalation and disposition tools kept routing separate from free-form model prose.
- Path-specific working-state fingerprints made late-result suppression deterministic.
- Removing the mode branch and old compatibility names simplified the final product contract.

## What Could Improve

The initial design kept the old Advisor name for the persistent feature and called the deep sub-agent Counsel. The operator's corrected topology should have been reflected in names immediately: Sentinel is the watcher; Advisor is the sub-agent.

## Learnings

Role names are architecture. When two roles have different lifetimes, capabilities, and owners, their public names and code symbols must remain distinct from the start.

## Improvements

Current docs, tests, package paths, tool parameters, status, and sidecar records now enforce that distinction. A separate backlog item tracks the unrelated parallel-suite WebSocket timeout observed during verification.

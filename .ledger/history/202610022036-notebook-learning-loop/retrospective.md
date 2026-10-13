Status: complete
Created: 2026-10-02
Updated: 2026-10-13

# Retrospective

## What Mattered

Capture became reliable once learnings were separated from status and a run-end reflection fork recorded them. Placement stayed manual, and most learnings never reached a durable owner.

## Learnings

- A human approval step on every placement does not scale; learnings pile up faster than the user reviews them. The user mostly agreed with proposals and rejected them only for scope (home-directory files, unwanted tracked files). A fixed write boundary can replace that review.
- Measure the loop from `notebook.maintenance` entries in `~/.pi/agent/sessions`; exclude files touched in the last day so active sessions do not count as losses.

## Improvements

Successor task `.ledger/202610130816-machine-owned-learnings/` places learnings automatically in machine-owned paths and keeps the user only for optional promotion.

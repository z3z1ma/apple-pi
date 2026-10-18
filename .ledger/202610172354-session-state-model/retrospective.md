Status: pending
Created: 2026-10-17
Updated: 2026-10-17

# Retrospective

## What Mattered

Pending completion of the undertaking.

## Learnings

- Before writing a spec from a cleared map, reread every ticket answer for ones a later ticket overrode (for example "views connect over the socket" versus the later "views read the database directly"); follow the later answer and say so.
- Model a relation that changes over time (which ledger task a session is on) as observed, timestamped links captured where it happens, not a fixed field or a convention someone must write. Asking the operator to choose capture conventions for a concept he never raised frustrated him; also avoid reusing a skill's word ("thread") that he reads differently.
- Before scoping a capability to the coordinator, check whether every root session already has it: mail and peer discovery belong to all root sessions; the coordinator gets only starting, reopening, and closing sessions.
- `node:sqlite` (DatabaseSync) works without a flag from Node 22.19, so the runtime needs no native addon.
- Peers are root Pi sessions with their own pane and TUI; subagents are in-process children started by `agent`. Keep the two words apart: the operator caught a question that mixed them.

## Improvements

Pending completion of the undertaking.

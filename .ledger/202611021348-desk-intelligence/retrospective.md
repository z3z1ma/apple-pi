Status: pending
Created: 2026-11-02
Updated: 2026-11-02

# Retrospective

## What Mattered

- Making ingestion the runtime's job, rather than `remind_me` sweeps, let the coordinator triage as items arrived.

## Learnings

- An explicit model choice must persist across restarts, or the coordinator falls back to the default model.

## Improvements

- Observe the scout's exploration over time before relying on its notes.

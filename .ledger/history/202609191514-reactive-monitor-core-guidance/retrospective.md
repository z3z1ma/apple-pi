Status: complete
Created: 2026-09-19
Updated: 2026-09-19

# Retrospective

## What Mattered

A distinct `monitor` creation verb made reactive intent clear without creating a second task manager. Complete stdout lines are the event protocol; normal task output, cancellation, cleanup, and completion notifications remain shared.

## Learnings

Immediate Pi steering and completion wake-ups serve different jobs and compose cleanly. Exact invocation belongs in tool schemas, while concise always-present guidance should explain capability selection. Native tools should not require a skill before ordinary use.

## Improvements

Keep future execution affordances narrow and reuse the managed-task substrate. Add skills only when they teach an optional advanced procedure rather than restating a native tool contract.

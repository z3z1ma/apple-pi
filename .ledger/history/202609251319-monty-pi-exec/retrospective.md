Status: done
Created: 2026-09-25
Updated: 2026-09-27

# Retrospective

## What Mattered

The type-checker, host-call budgets, and Pi session tree had to remain one coherent execution boundary. Public tests through the registered tool caught failures that a standalone Monty probe did not: cross-feed typing, branch restore, authenticated reload, terminal rollback, and cancellation of gathered host work.

## Learnings

Monty infers an unannotated global such as `x = 1` as a literal type; annotate `x: int` if later feeds will assign other integers. Its suspension limit accumulates per checkout, so rotate from the last checkpoint before host-call usage reaches the limit. `session.close()` alone does not interrupt an in-flight feed; abort pending host calls, stop the active worker, and await cleanup. Session JSONL can be imported, so verify a dump's authentication and stub compatibility before calling Monty's `loadSession`.

## Improvements

A public Monty worker-termination API would remove the need to stop the owned in-flight worker by its captured PID. Until then, restrict that fallback to a feed known to be in flight and keep the timeout, rollback, and orphan-process regressions.

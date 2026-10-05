Status: complete
Created: 2026-10-04
Updated: 2026-10-04

# Retrospective

## What Mattered

- The benchmark answered the real question in 91 minutes for about $12: with explicit goals, a single agent solves the traps, so search had no headroom.
- Scorer kill rate on known-wrong solutions was 100% with or without challengers; the authored checks were not the limit on these traps, their blind spots were (the slugify misses).

## Learnings

- Benchmark tasks must include ones where a single run actually fails; otherwise only cost can show.
- A judge written by the same model as the attempts cannot select for what that model misses.
- Smallest-diff tie-breaks prefer the less complete of two survivors under incomplete checks.
- The eval harness hid catalog-only models until the downloaded catalog was copied into its isolated state.

## Improvements

- Run a cheap end-to-end demo before ticketing a design.

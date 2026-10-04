Status: planning
Created: 2026-10-04
Updated: 2026-10-04

# Repository histories as replay worlds for improving the harness

## Intent

Treat each completed ledger task, with its transcripts, start and end commits, and scalar measures, as a stored history. Accumulate them per repository, and replay (free, for policies that only react to recorded events) or re-simulate (paid, for policies that change what the model sees) harness policies over them, so the agent works measurably better in this repository. Inspired by Dream-RSI (https://www.dream-rsi.com/, https://github.com/zhengkid/Dream-RSI). Full reasoning and evidence: `notes.md`.

## Current State

Captured, not shaped. Open questions in `notes.md` section 9. Branch-search cleanup (separate work) comes first.

## Outcome

Pending.

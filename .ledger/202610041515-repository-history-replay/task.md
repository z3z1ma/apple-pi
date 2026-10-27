Status: planning
Created: 2026-10-04
Updated: 2026-10-27

# Repository histories as replay worlds for improving the harness

## Intent

Treat each completed ledger task, with its transcripts, start and end commits, and scalar measures, as a stored history. Accumulate them in every repository (or parent directory) that has a `.ledger/`, and replay (free, for policies that only react to recorded events) or re-simulate (paid, for policies that change what the model sees) harness policies over them, so the agent works measurably better: fewer turns to an accepted change, fewer user corrections, lower cost, and first-time adherence to conventions. Inspired by Dream-RSI (https://www.dream-rsi.com/, https://github.com/zhengkid/Dream-RSI). Full reasoning, evidence, and decisions: `notes.md` (decisions in section 10).

## Previous capture (removed)

The operator removed automatic ledger capture entirely on 2026-10-27. Workplace state and explicit task/artifact links supersede the session-pointer files. The former capture acceptance criteria are withdrawn; the shelved notes and spec describe a historical design, not a current implementation contract.

## Step 2: REM (shelved design notes, not ready for implementation)

The methodology is named REM (Replay, Evaluate, Mutate), run as `/rem`. Draft spec: `spec.md`. Operator decisions: a simulated user replays the original user; the scorecard is oracle tests as the gate plus turns, corrections, cost, and convention findings; variants are model-proposed; the simulated user and proposer may send transcripts to the user's own model profiles; `/rem` is a shipped Pi command; the first ticket is a tracer bullet on one world.

## Later steps (open)

Re-simulation design for AGENTS.md and skills (level 2 in `notes.md` section 5: re-run real past tasks from their base commit with a changed AGENTS.md or skill, and compare against the recorded outcome): the scorecard (the four measures in the intent), the runner (building on `components/history-eval/`), choosing histories, cost limits set by the operator, and the transfer test on fresh tasks.

## Current State

Shelved by the operator (2026-10-04): the replay plumbing was half-baked. The replay harness, commit recording and automatic session-pointer capture are all removed. The notes and spec retain the old design; resuming replay requires a fresh decision based on current workplace state rather than restoring that capture.

## Outcome

Pending.

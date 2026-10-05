Status: planning
Created: 2026-10-04
Updated: 2026-10-04

# Repository histories as replay worlds for improving the harness

## Intent

Treat each completed ledger task, with its transcripts, start and end commits, and scalar measures, as a stored history. Accumulate them in every repository (or parent directory) that has a `.ledger/`, and replay (free, for policies that only react to recorded events) or re-simulate (paid, for policies that change what the model sees) harness policies over them, so the agent works measurably better: fewer turns to an accepted change, fewer user corrections, lower cost, and first-time adherence to conventions. Inspired by Dream-RSI (https://www.dream-rsi.com/, https://github.com/zhengkid/Dream-RSI). Full reasoning, evidence, and decisions: `notes.md` (decisions in section 10).

## Step 1: capture (settled 2026-10-04)

The ledger extension records, in each task bundle's `history.json`, only pointers; every measure is derived later from the transcripts, so a better measure applies to every history retroactively.

- **Sessions:** the Pi session IDs linked to the task. A session is linked when it calls `ledger_add` or `ledger_status` for the task, or edits a file inside the task's bundle.
- **Commits:** `HEAD` of the repository the session works in, when the task moves to `in-progress` and when it closes (`done` or `cancelled`). With a parent-directory ledger spanning several repositories, each entry names the repository it came from.
- **Privacy:** session IDs are pointers; transcripts stay in the local Pi session store. A shared `.ledger/` carries IDs, not transcripts.

Acceptance criteria:

- Creating a task, moving it to `in-progress`, and closing it in a test repository writes `history.json` with the session ID and the start and close commits.
- A second session that only edits a file in the bundle is added to `history.json`; a session that never touches the task is not.
- A parent-directory ledger records the repository of each commit entry.
- The archived bundle in `.ledger/history/` keeps `history.json`.
- `docs/ledger.md` describes `history.json`; the ledger system prompt stays unchanged unless the agent needs to act on it.

## Later steps (open)

Re-simulation design for AGENTS.md and skills (level 2 in `notes.md` section 5: re-run real past tasks from their base commit with a changed AGENTS.md or skill, and compare against the recorded outcome): the scorecard (the four measures in the intent), the runner (building on `components/history-eval/`), choosing histories, cost limits set by the operator, and the transfer test on fresh tasks.

## Current State

Step 1 settled and ready to implement. Later steps still open.

## Outcome

Pending.

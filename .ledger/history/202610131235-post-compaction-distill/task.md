Status: done
Created: 2026-10-13
Updated: 2026-10-13

# Distill learnings in a fork after compaction

## Intent

Give each stage of the learning loop one job and its own cadence:

- **Capture.** The notebook holds learnings for the current session. The primary, the pair, and subagents add to it; the token-spaced reflection fork and `/reflect` capture only.
- **Distill.** Moves durable learnings from the notebook to machine-owned project files, keeps those still guiding the current work, and retires stale ones. Runs in a fork right after compaction, at ledger close, and on `/distill`.
- **Promote.** `/promote` proposes moving learnings from machine-owned files to human-owned ones (`AGENTS.md`, skills, docs) and writes only what the user approves.

Follows `.ledger/history/202610130816-machine-owned-learnings/`, which put placement inside reflection. The user found that redundant: one model adds to the notebook and another immediately retires from it.

## Decisions

- Distill runs in a fork of the conversation, not a fresh worker: a fresh worker loses the implicit context of a long session (user, 2026-10-13).
- The fork starts at `session_compact`. Right after compaction it has room, the fresh summary, and the open learnings. Waiting for the next completed run could use up that room.
- Reflection and distill forks run in one serial lane, so a distill due during a reflection waits for it and sees what it captured. `registerForkedContinuation` does not order separate registrations.
- Destinations are chosen by how a future agent finds them: `.pi/LEARNINGS.md` is always loaded; `.wiki/` is searched; a retrospective is read for related tasks; `.pi/programs/` becomes a tool (user, 2026-10-13).
- `.pi/LEARNINGS.md` is read at each `before_agent_start`. A changed section reaches the model as an appended system-message delta before the next user message; an unchanged one adds nothing (verified with a faux session, 2026-10-13). Pi folds deltas into the leading system message at the next compaction (Pi docs; not tested).
- A fork's provider requests go through the parent's `before_provider_request`, where server compaction injects the newest compaction for the parent branch (`components/server-compaction/src/hooks.ts`), so a fork after server-side compaction replays it (code reading).

## Acceptance criteria

- The reflection prompt asks only for capture.
- After a compaction with open learnings, one distill fork runs with every open learning in its prompt; with none open, nothing runs.
- A distill that becomes due while a reflection fork runs starts only after the reflection settles.
- Ledger close and `/distill` send the same distill instruction in the main conversation.
- `/promote` replaces the prompt template formerly named `/distill`.
- `.pi/LEARNINGS.md` changes reach the next run's system prompt.
- Docs (`docs/context.md`, `docs/promote.md`, `README.md`, `AGENTS.md`) describe the three stages.

## Known limits

- A session that never compacts or closes a task loses its open learnings unless the user runs `/distill`.
- A distill fork after a compaction in the middle of a run runs alongside the main agent; both may edit the same machine-owned file.

## Current State

Implemented 2026-10-13:

- `components/notebook/src/hooks/learning-cycle.ts` (was `learning-reflection.ts`): capture-only reflection, the distill fork at `session_compact`, one serial fork lane, `/reflect`, and `/distill`.
- `components/notebook/src/distillation.ts`: the distill instruction with every open learning listed; also used by the ledger-close hold.
- `components/shared/src/forked-continuation.ts`: the start function returns a promise that settles with its fork, so the lane can order forks.
- `components/notebook/src/hooks/project-learnings.ts`: reads `.pi/LEARNINGS.md` at each run.
- `prompts/promote.md` and `docs/promote.md` replace the old `/distill` template; `docs/context.md`, `docs/forked-continuations.md`, `README.md`, and `AGENTS.md` describe the three stages.

Checks: format, lint, typecheck, unit (1431), pair (118), loader, and pack dry run pass.

## Outcome

Delivered. Not yet observed in real use: distill quality after real compactions, server-side compaction replay in the fork (code reading only), and Pi folding the `.pi/LEARNINGS.md` delta into the leading system message at the next compaction (Pi docs only).

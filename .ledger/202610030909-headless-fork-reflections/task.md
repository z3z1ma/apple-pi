Status: planning
Created: 2026-10-03
Updated: 2026-10-03

# Run passive reflections in headless forks of the conversation

## Intent

Passive, automatic injections that make the model act (change reflection, automatic learning reflection) stop continuing the main run. Each one runs as a headless fork of the live conversation and returns one aggregated message. The message is added to the stack without a steer or continuation: it shows as one line in the chat, and the model sees it on its next request (inside the current run if one is streaming, otherwise on the next turn). User-invoked commands and prompts (`/reflect`, `/distill`) stay in-band.

User decisions:

- A fork is the identical conversation branching: same system prompt, same tool loadout, same model and thinking level, same provider session id (prompt cache key), same messages. Only the continuation prompt is appended.
- The change-reflection fork may edit files headlessly.
- The learning fork records learnings in the notebook only. `/reflect` journals; `/distill` places learnings in their homes.

## Approach

- `components/shared/src/forked-continuation.ts`: capture the live `AgentSession` keyed by its session manager, clone its `Agent` (state, `convertToLlm`, `transformContext`, `streamFunction`, payload/response hooks, tool hooks, `sessionId`), seed it with `sessionManager.buildSessionProjection().messages`, and run the prompt. Skip the session-bound `prepareRequest`/`finishTurn`/`prepareNextTurn*` hooks so nothing writes to the parent transcript. Mark fork execution with an AsyncLocalStorage scope so passive trackers ignore fork tool events. Block `ask_user_question` in the fork.
- Deliver with `pi.sendMessage({ display: true }, { triggerTurn: false })` and a one-line renderer.
- Change reflection and learning reflection start forks at `agent_settled` after a completed run.

## Acceptance criteria

- The fork's first provider request equals the parent's next request prefix plus the appended prompt (test).
- A completed edit run delivers exactly one change-reflection message and no extra parent request (test).
- Edits made by a fork do not trigger another reflection (test).
- Learnings recorded by a fork land in the parent notebook (test).
- `/reflect` stays in-band and asks only for journaling.
- Docs and AGENTS.md describe the new model; format, lint, typecheck, tests, and loader check pass.

## Current State

Implemented and validated; awaiting user review. Not committed.

## Outcome

- `components/shared/src/forked-continuation.ts` holds the fork, its delivery, its one-line renderer, and its usage accounting (`forked_continuation` usage entries).
- Change reflection and the automatic learning reflection run as forks at `agent_settled`. `/reflect` stays in-band and only journals.
- Tests: identical request prefix, one passive message without an extra parent request, fork edits kept and not reflected again, fork learnings in the parent notebook.
- Real host (Pi 1.0, OpenAI, RPC): the fork's first request read the parent's full cached prefix (cacheRead 11136, uncached input 281).
- Follow-up candidates: other passive prompts that make the model act (the ledger-close learning reminder, pair notes) could use the same mechanism.

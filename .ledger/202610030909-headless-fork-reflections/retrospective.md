Status: pending
Created: 2026-10-03
Updated: 2026-10-03

# Retrospective

## What Mattered

- In Pi, a fork is the identical conversation: same system prompt, tools, model, cache key, and messages. Copying the live session's agent and its projected messages kept the request identical, and the fork read the parent's whole cached prefix on the real host.
- Pi already had the requested delivery: `sendMessage` with `triggerTurn: false` adds one message without a steer or continuation.

## Learnings

- User correction: while designing the fork, I assumed it would be a clarify-style snapshot with a different system prompt and tools, and asked the user whether to accept a prompt-cache miss. That was wrong and cost trust. Check fork or cache identity in Pi's code (see `.wiki/pages/pi-request-internals.md`) before presenting a cost trade-off.

## Improvements

- Pending: keep learning evidence until a fork succeeds, so a failed or cancelled learning reflection is retried.

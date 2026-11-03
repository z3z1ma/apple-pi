Status: pending
Created: 2026-11-01
Updated: 2026-11-01

# Retrospective

## What Mattered

- Live checks found what fixtures missed: the first real PR comment exposed the empty-prompt wake bug.

## Learnings

- Waking a person for waiting mail needs a non-empty steer prompt. Replayed mail is delivered for the next turn at startup, and an empty prompt starts no turn, so the woken person sat idle with mail marked delivered but never applied. The fake pi in the on-call tests only logged commands, so they passed; Fiona's live PR check caught it. The on-call test now asserts the steer.
- A coordinator that has not reloaded has `sessions.on_call` null, so on-call wake skips it. A channel's charter listener is woken on every post regardless (`queueDelivery(..., onDuty)`), so set the desk channel's listener whenever the desk is set.
- Dispatch posture had to be structural: `writes: false` removed only edit/write and left bash, so 'the coordinator only dispatches' was prompt-only until `Role.dispatches` also removed bash and pi_exec.

## Improvements

- A live CI event check needs a repository with workflows.

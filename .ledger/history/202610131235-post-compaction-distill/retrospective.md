Status: complete
Created: 2026-10-13
Updated: 2026-10-13

# Retrospective

## What Mattered

Capture and distill are different questions and need different cadences. Running them back to back made the second one redundant. Compaction is the natural boundary for distill: the context is about to be forgotten, and right after it the fork has room and the fresh summary.

## Learnings

- A changed `before_agent_start` prompt section reaches the model as an appended system message, not a rewrite of the top; an unchanged one adds nothing. Verify such claims with a faux session (`tests/helpers/faux-session.ts`) before designing around them.
- Separate `registerForkedContinuation` registrations run their forks concurrently. Order them with a promise lane when one fork depends on another's notebook changes.

## User corrections

- Keep the learning loop minimal: no path guards, commit guards, or tracked-path handling. `.gitignore` is the sharing control; prompt guidance is enough to keep `.pi/LEARNINGS.md` short. Propose safety machinery only with evidence of a real failure.
- Reflection captures; distill moves durable learnings to machine-owned files at its own cadence; promotion to shared files is separate and optional. Keep distill in the live conversation: a fresh worker loses the implicit context of a long session.

Status: done
Created: 2026-10-17
Updated: 2026-10-18

# Retrospective

## What Mattered

- One writer (the runtime) and plain readers (views open the database directly, change it only through commands) kept every consumer simple; the cut-over deleted about 1,300 lines of file-based state.
- Honesty rules from the spec (sent is not delivered, settled is not done, an outage is a recorded gap) caught real bugs in review: mail acknowledged before Pi wrote the session file, a gap that started after the outage, stale incarnations answering commands.
- Two-lane reviews (standards and intent) after each batch found real defects every time; the intent lane caught spec gaps the tests did not exercise.

## Learnings

- Before writing a spec from a cleared map, reread every ticket answer for ones a later ticket overrode (for example "views connect over the socket" versus the later "views read the database directly"); follow the later answer and say so.
- Model a relation that changes over time (which ledger task a session is on) as observed, timestamped links captured where it happens, not a fixed field or a convention someone must write. Asking the operator to choose capture conventions for a concept he never raised frustrated him; also avoid reusing a skill's word ("thread") that he reads differently.
- Before scoping a capability to the coordinator, check whether every root session already has it: mail and peer discovery belong to all root sessions; the coordinator gets only starting, reopening, and closing sessions.
- `node:sqlite` (DatabaseSync) works without a flag from Node 22.19, so the runtime needs no native addon.
- Peers are root Pi sessions with their own pane and TUI; subagents are in-process children started by `agent`. Keep the two words apart: the operator caught a question that mixed them.
- Pi writes a new session's file only once it holds a user or assistant message (`SessionManager._hasConversation`); anything that treats `getEntries()` as durable must wait for that.
- A read-only SQLite connection sees no rows of a WAL database once its `-shm` file is gone; readers open it for writing with `pragma query_only`.
- A tmux window started by `tmux new-window` gets the PATH of the client that ran the command, so the runtime's PATH decides which `pi` a started session runs; tests put their fake `pi` on the PATH before starting the runtime.

## Improvements

- Write tests that end every faux session with `session_shutdown` in `finally` from the first draft; three review rounds found setup paths that could leak a bridge, which then restarts a runtime into a deleted directory.
- Ask the operator about activation and scope (who gets a tool, which flag) before building, as with `--coordinator`; it was cheap to settle and expensive to change.
- A spec phrase like "through the session's bridge" can hide a simpler route (one socket client shared by tools, scripts, and views); name such deviations in the docs when taking them.

Status: in-progress
Created: 2026-10-18
Updated: 2026-10-18

# Shared Pi and tmux state model for all of apple-pi

## Intent

Find the way to a spec for one rich, solid state model of Pi sessions, tmux, and processes that replaces apple-pi's existing runtime state and that every apple-pi consumer uses: the sidebar, dashboard, status line, notch, mailbox, coordinator, and Agent World. Split out of the Agent World map (`.ledger/202610171741-guildworld/`) when the operator made the state model the foundation.

## Current State

Done. All 16 tickets are implemented and committed; each batch had a two-lane review (standards and intent) whose confirmed findings were fixed. Decisions the operator made during the build: the coordinator tools are active only with `pi --coordinator`; a stopped subagent stays live and resumable until its parent ends or switches (ticket 06 deviation); mail and peer discovery belong to every root session.

## Follow-ups

- Views do not start the runtime themselves (spec: "started on demand by the first bridge or view"): the sidebar, dashboard, and notch report the runtime as down instead. Every Pi session's bridge starts it, so a view without a runtime has no sessions to show; revisit if a view must work before any Pi starts.
- The notch page keys rooms and choices by tmux session name, so two tmux servers with a session of the same name share a room. Key by server and session id if the operator runs several servers.
- `seen_at` changes only when the operator sees a session after it settled, not on every look, to avoid a write per second; a view that wants "last looked at" would need it on every look.
- Subagent build-up (operator, 2026-10-18): within one root session, completed and stopped top-level subagents stay in memory until that session ends or switches (`AgentManager.cleanup` releases only nested and internal ones, 10 minutes after they finish). A long-lived root session such as a coordinator can accumulate many. Proposed: release a finished top-level subagent whose result was read after a delay the operator chooses; a `dispose` option on `stop_subagent` was considered and set aside to keep the tool simple. Outside this task's tickets.

## Outcome

`components/session-state/` is the one state model of Pi sessions, tmux, and processes (`docs/session-state.md`): a bridge in every root and interactive child session, one runtime daemon per Mac as the only writer of `~/.pi/agent/state/apple-pi.db`, and a socket for commands with receipts. On it: rich activity, the conversation index with read-through, relations and ledger work links, subagent sessions, honest outage gaps, questionnaires answerable from either side, mail (replacing the mailbox files), peer discovery, coordinator start/reopen/close tools, attention and the tmux status line, and UI preferences. The sidebar, dashboard, and notch read the database and write through commands; the tmux JSON records, `agents.py`, the mailbox files, `notch.json`, and the focus hook are gone. Final checks: format, lint, typecheck, `npm test` (Vitest, sidebar pytest, pair harness, loader), and `pack:check`.

Status: in-progress
Created: 2026-10-18
Updated: 2026-10-18

# Shared Pi and tmux state model for all of apple-pi

## Intent

Find the way to a spec for one rich, solid state model of Pi sessions, tmux, and processes that replaces apple-pi's existing runtime state and that every apple-pi consumer uses: the sidebar, dashboard, status line, notch, mailbox, coordinator, and Agent World. Split out of the Agent World map (`.ledger/202610171741-guildworld/`) when the operator made the state model the foundation.

## Current State

The spec (`spec.md`) and 16 tickets are approved. Tickets 01-09 are done and committed, not pushed; 01-07 are reviewed (two lanes) and fixed. Ticket 06 deviates by operator decision: a stopped subagent stays live and resumable until its parent ends or switches, so its incarnation ends then, not at stop. Next: review 08-09, then 10-12 (seams confirmed), then 13-16. Execution rule from the operator (2026-10-18): commit after each ticket; do not push until every ticket is done; run only relevant tests until close.

## Follow-ups

- Subagent build-up (operator, 2026-10-18): within one root session, completed and stopped top-level subagents stay in memory until that session ends or switches (`AgentManager.cleanup` releases only nested and internal ones, 10 minutes after they finish). A long-lived root session such as a coordinator can accumulate many. Proposed: release a finished top-level subagent whose result was read after a delay the operator chooses; a `dispose` option on `stop_subagent` was considered and set aside to keep the tool simple. Outside this task's tickets.

## Outcome

Pending: `/skill:to-spec` writes the spec from the cleared map.

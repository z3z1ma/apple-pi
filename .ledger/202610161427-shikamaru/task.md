Status: planning
Created: 2026-10-16
Updated: 2026-10-16

# Shikamaru: chief-of-staff Pi session that tracks every thread and runs worker sessions

## Intent

One long-lived Pi session, Shikamaru, is where the operator lives. The operator dumps every thought, thread and commitment into it. Shikamaru:

- organizes the dumps into dated, prioritized threads, projects and commitments, and does supporting research;
- keeps that state on disk so it still knows what happened two weeks ago, and notices what has been sitting too long ("you said you would do X twelve days ago");
- starts real top-level Pi sessions in tmux (their own PTY, directory or worktree), briefs them, watches them, nudges them and reports on them, so the operator does not have to read every worker;
- reaches out on its own with summaries and suggestions.

The model is the Codex "Dots" experience as the operator described it: one place to drop an ambitious goal, then come back to find it delegated, done and summarized. Workers stay first-class: the operator can open their pane, or jump to them from the sidebar, dashboard or notch.

## Decisions

- **Name and home:** Shikamaru, in `~/shikamaru`, private and outside this repository. Reusable parts (charter template, skill, setup scripts) ship in apple-pi.
- **Persona through files, not code:** `~/shikamaru/AGENTS.md` is the charter: how to prioritize, when to start a worker, how to brief one, when to bother the operator. Shikamaru always runs as `pi --session-id shikamaru` in its own tmux pane.
- **The disk is the memory.** The session can be thrown away; everything Shikamaru knows lives in files it re-reads.
- **Work lives in one of three places, with one index in `~/shikamaru`:** a committed repo `.ledger`; a private repo `.ledger` listed in `.git/info/exclude`; or Shikamaru's own `.ledger` for work tied to no repo. The index records where each thread lives, when it was last touched, what was committed to, and when to nag. Workers own their repo ledger tasks (the ledger tools write to the current directory); Shikamaru owns the pointers.
- **Maximum access:** every connected MCP (Atlassian, Slack, Wispr Flow), skills, `gh`, `gcx` and environment variables. A capability map in `~/shikamaru` records which tool serves which need and where credentials live, never the secrets.
- **Full autonomy:** Shikamaru starts workers without asking. The charter carries the judgment.
- **Workers** start as `tmux new-window -c <dir> pi --session-id <id> --name <name> "<brief>"`. Shikamaru picks the id, so it can find the worker's tmux state record (`~/.pi/agent/state/tmux-sessions/<id>.json`), session JSONL and mailbox.
- **Communication** runs through the [session mailbox](../202610161427-session-mailbox/task.md) in both directions.

## Open questions

- **Heartbeat:** whether to have a clock at all yet. Options: launchd (survives Pi being closed, more moving parts), a clock started by Shikamaru's own session (simple, dies with Pi), or no clock until something gets missed. The sweep itself runs in Shikamaru's pane and delegates heavy gathering to subagents or `pi_exec`.
- **Outward-facing actions:** whether the charter requires approval for actions that speak as the operator (Slack posts, Jira comments, merging shared PRs). Not answered yet.
- Index format, staleness rules and worker briefing contract.

## Acceptance criteria

To be settled at shaping. Depends on the session mailbox.

## Current State

Planning. Concept discussed with the operator; heartbeat and outward-facing approval are open. Next: finish the session mailbox first, then draft the charter, index format and worker briefing contract with the operator.

## Outcome

Pending.

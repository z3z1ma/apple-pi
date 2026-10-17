Status: done
Created: 2026-10-16
Updated: 2026-10-16

# Retrospective

## What Mattered

- The operator's correction "the more you try to control, the dumber the models get" shaped the result: the skill states goals and the few cross-session conventions and leaves directories, worktrees, briefs and staleness to Orchard. Live runs showed a capable model needs little more.
- The live acceptance run found what reading the skill could not: a worker window closed before the operator replied, and a restarted Orchard that never noticed its scheduled sweep was gone.
- An Orchard is a directory plus a session id, not a fixed place. Several can run side by side because each has its own id, which is also its mailbox address.

## Learnings

- `pi --session-id` reopens the same conversation, so an agent cannot tell it restarted; anything held in memory (schedules) must be checked, not assumed.
- Pi applies an `AGENTS.md` to every session in its directory and below. A charter for one session in a workspace that contains repositories belongs in a file passed with `--append-system-prompt`.
- Isolating a live Pi run needs more than environment variables: tmux gives new panes the creating client's PATH, `-xt 'mcp__*'` hides MCP tools while servers still connect (use `--no-mcp`), and `--session-dir` does not reach subagents (use `PI_CODING_AGENT_SESSION_DIR`).

## Improvements

- Probe a test harness's isolation (which binary runs, where sessions land, whether MCP connects) before the first paid live run, not after.

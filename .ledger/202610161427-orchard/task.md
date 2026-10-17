Status: in-progress
Created: 2026-10-16
Updated: 2026-10-16

# Orchard: chief-of-staff Pi session that tracks every thread and runs worker sessions

## Intent

One long-lived Pi session, Orchard, is where the operator lives. The operator dumps every thought, thread and commitment into it. Orchard:

- organizes the dumps into dated, prioritized threads, projects and commitments, and does supporting research;
- keeps that state on disk so it still knows what happened two weeks ago, and notices what has been sitting too long ("you said you would do X twelve days ago");
- starts real top-level Pi sessions in tmux (their own PTY, directory or worktree), briefs them, watches them, nudges them and reports on them, so the operator does not have to read every worker;
- reaches out on its own with summaries and suggestions.

The model is the Codex "Dots" experience as the operator described it: one place to drop an ambitious goal, then come back to find it delegated, done and summarized. Workers stay first-class: the operator can open their pane, or jump to them from the sidebar, dashboard or notch.

## Principle

**Guidance, not control.** Agents with bash do the right thing given very little guidance; the more the procedure tries to control, the worse they work. The skill and charter state goals and the few conventions other sessions depend on (where state lives, how to report back), and leave everything else to Orchard's judgment: which directory or worktree a worker uses, how to phrase a brief, when to check in. Nothing is enforced in code.

## Decisions

- **Name and home:** Orchard (renamed from the working name Shikamaru). Any directory with a charter can be an Orchard home, started with any session id; `~/orchard` with `pi --session-id orchard` is the example used below. The session id is the Orchard's mailbox address, and mailboxes are shared across directories, so an operator who runs several Orchards (for example one for work, one personal) gives each its own id, such as `orchard-work` and `orchard-home`. The charter names the id. Homes stay private and outside this repository.
- **Procedures in a packaged skill, judgment in a private charter.** apple-pi ships an `orchard` skill with the procedures (taking in dumps, keeping threads, starting and briefing workers, sweeping). `~/orchard/AGENTS.md` holds only the operator's own judgment (priorities, people, preferences, sweep sources and cadence) and tells Orchard to use the skill. Package updates reach Orchard through the skill.
- **The disk is the memory.** The session can be thrown away; everything Orchard knows lives in files it re-reads.
- **Orchard's own ledger is the thread index.** Every thread is a ledger task in `~/orchard/.ledger`; `.ledger/INDEX.md` is the index. Work that lives in a repo gets a pointer task there that names the repo ledger task the worker owns (a committed repo `.ledger`, or a private one listed in `.git/info/exclude`). Plain lines in `task.md`, such as a due date or a nag-after date, drive staleness; no new file format.
- **Maximum access:** every connected MCP (Atlassian, Slack, Wispr Flow), skills, `gh`, `gcx` and environment variables. A capability map in `~/orchard` records which tool serves which need and where credentials live, never the secrets.
- **Full autonomy, including actions that speak as the operator** (Slack posts, Jira comments, merges). There is no approval step; the charter carries the judgment.
- **Workers are top-level Pi sessions in tmux windows.** Orchard picks the session id and writes the brief to a file, then starts the worker with `pi --session-id <id> --name <name> @<brief file>` (Pi expands `~` and reads `@file` as prompt text, so long briefs need no shell quoting). With the id it finds the worker's tmux state record, session file and mailbox. Orchard chooses the directory: an existing checkout, a worktree, or anything else the work needs.
- **Communication runs through the [session mailbox](../history/202610161427-session-mailbox/task.md).** Every brief asks the worker to `mailbox_send` to `orchard` when it finishes or is blocked; Orchard redirects a worker the same way.
- **Finished workers stay open until the operator has seen them.** Orchard summarizes the result and closes the window after the operator acknowledges it.
- **`~/orchard` is a local git repository.** Orchard commits its ledger and charter changes. Whether to add a private remote is the operator's choice.
- **Staleness is Orchard's judgment.** The skill asks Orchard to note a due or follow-up date in plain words in a thread's `task.md` when one exists; Orchard judges staleness from those and the `Updated` date. No fixed header lines.
- **Heartbeat v1 is a self-scheduled sweep.** After each sweep Orchard uses `schedule` to set the next one. It stops when Orchard's pane closes, which is acceptable. The charter decides what a sweep scans beyond Orchard's ledger and workers, and how often.

## Deliverables

1. `skills/orchard/SKILL.md` in apple-pi: short, written with the `skill-authoring` skill.
2. ~~An Orchard home set up with the operator~~: moved out of this task by the operator; creating his Orchard homes is a separate concern.

## Acceptance criteria

1. In Orchard's pane, a brain dump becomes dated ledger tasks in `~/orchard/.ledger`, and repo work gets a pointer to the repo ledger task its worker owns.
2. Given work, Orchard starts a worker in a new tmux window as a top-level Pi session with its brief, and records the worker's session id in the thread.
3. A worker that finishes or gets blocked reports to `orchard` through the mailbox, and Orchard summarizes that to the operator without the operator reading the worker.
4. After Orchard's process restarts (`pi --session-id orchard`), it answers "what is going on with X" from disk.
5. A sweep reports threads that look stale (past a noted due or follow-up date, or untouched for a long time) and the state of every worker, then schedules the next sweep.
6. The skill is packaged: `npm run pack:check` lists `skills/orchard/SKILL.md`, and the package-load test passes.

## Current State

Done. Approved by the operator for closing.

## Outcome

Shipped the `orchard` skill (`skills/orchard/SKILL.md`, commit `52d8d69` plus a follow-up that drops the `AGENTS.md`-only wording) and its package-load entry. Two live acceptance runs are recorded in [evidence/acceptance-run.md](evidence/acceptance-run.md); run 2 passed every criterion after two guidance fixes. Known limits of that evidence: no end-to-end run used the final `--no-mcp` harness, shell network access was blocked only by the test charter, and scratch runs shared logs and caches under the real agent directory.

The operator's first Orchard lives in `~/code_projects/work` (commit `e432199` there): `ORCHARD.md` is the charter and `./orchard` starts `pi --session-id orchard-work --append-system-prompt ORCHARD.md`. The charter is not an `AGENTS.md` because Pi applies `AGENTS.md` to every session below its directory, and that workspace's repositories and worktrees sit below it.

# Orchard specification

Governing task: [task.md](task.md). Built on the [session mailbox](../history/202610161427-session-mailbox/task.md), whose contract is in `docs/tasks.md#session-mailbox`.

## Problem Statement

The operator runs dozens of threads at once: projects in several repositories, commitments to people, ideas, and admin with no repository at all. He switches context constantly and dumps thoughts as they come. Nothing holds those threads together over weeks, so things he said he would do sit untouched and get forgotten. Running coding agents makes it worse: each Pi session knows only its own work, so he has to visit every pane to learn what is going on and to keep work moving.

Inside one Pi session, subagents do not solve this. They live and die with that session, and they are not first-class sessions he can open, jump to from the sidebar, dashboard or notch, or leave running in their own directory.

## Solution

Orchard is one long-lived Pi session, started as `pi --session-id orchard` in `~/orchard` in its own tmux pane, where the operator lives. He dumps anything into it. Orchard turns the dumps into dated threads in its own ledger and keeps that ledger as the index of everything going on. It does research, starts real top-level Pi sessions (workers) in tmux windows to carry out work, briefs them, watches them, redirects them, and summarizes their results, so he does not have to read every worker. It wakes itself on a schedule, sweeps all threads and workers, tells him what has gone stale, and suggests what to do.

Orchard keeps everything on disk. The session can be thrown away and restarted without losing what it knows. Workers and Orchard talk through the session mailbox in both directions.

Orchard gets very little procedure: a short packaged `orchard` skill states the goals and the few conventions other sessions depend on, and a private charter in `~/orchard/AGENTS.md` holds the operator's own judgment. Orchard decides everything else.

## User Stories

1. As the operator, I want one Pi session I can always return to, so that I have a single place to dump every thought, task and commitment.
2. As the operator, I want to dump an unstructured mix of topics in one message, so that I do not have to sort my thoughts before I share them.
3. As the operator, I want Orchard to split a dump into separate threads, so that each concern is tracked on its own.
4. As the operator, I want each thread recorded as a ledger task in Orchard's own ledger, so that the threads survive the session and use a format I already know.
5. As the operator, I want Orchard's ledger index to be the list of everything going on, so that one file answers "what am I juggling".
6. As the operator, I want Orchard to add to an existing thread when I mention it again, so that a topic does not split into duplicates.
7. As the operator, I want Orchard to note a due date or follow-up date in a thread when I give one or one is implied, so that it can hold me to it.
8. As the operator, I want Orchard to tell me when something I committed to has been sitting too long, so that I stop forgetting things.
9. As the operator, I want Orchard to judge staleness from the dates it noted and how long a thread has been untouched, so that I do not have to maintain fixed fields.
10. As the operator, I want Orchard to do supporting research on a thread, so that I get context without asking for it step by step.
11. As the operator, I want Orchard to keep track of work that lives in a repository, so that repo work and non-repo work sit in one index.
12. As the operator, I want repo work to have a pointer thread in Orchard that names the repo ledger task the worker owns, so that the detail stays with the code and Orchard still knows where to look.
13. As the operator, I want Orchard to use a repo's committed ledger when the repo has one, so that shared work stays visible to the repo's other users.
14. As the operator, I want Orchard to use a private ledger in a repo that does not adopt the convention, listed in `.git/info/exclude`, so that I can track work there without changing the repo.
15. As the operator, I want Orchard to start a worker on its own when a thread needs work done, so that ambitious goals get delegated without me setting up a session.
16. As the operator, I want each worker to be a real top-level Pi session in its own tmux window, so that I can open it, watch it, and jump to it from the sidebar, dashboard or notch.
17. As the operator, I want Orchard to choose the worker's directory itself (an existing checkout, a worktree, or whatever the work needs), so that it fits the work without fixed rules.
18. As the operator, I want Orchard to honour a directory I name, so that I stay in control when I care.
19. As the operator, I want Orchard to write each brief to a file and start the worker with it, so that long briefs reach the worker intact.
20. As the operator, I want Orchard to record each worker's session id in its thread, so that Orchard can find the worker's tmux state, session file and mailbox later.
21. As a worker, I want my brief to tell me to report to `orchard` through the mailbox when I finish or get blocked, so that Orchard learns my outcome without polling me.
22. As a worker, I want to keep my own repo ledger task current, so that my progress survives my session and Orchard can read it.
23. As the operator, I want Orchard to summarize a worker's report for me, so that I do not have to read the worker's transcript.
24. As the operator, I want Orchard to redirect a running worker through its mailbox, so that a change of plan reaches it at its next safe point.
25. As the operator, I want Orchard to answer "how is X going" from the worker's state, mailbox, session file and ledger task, so that I get an update without switching panes.
26. As the operator, I want a finished worker's window to stay open until I have seen the result, so that I can inspect it before it goes away.
27. As the operator, I want Orchard to close a finished worker's window after I acknowledge it, so that tmux does not fill with dead windows.
28. As the operator, I want Orchard to wake itself on a schedule, so that it checks on things without me asking.
29. As the operator, I want each sweep to schedule the next one, so that the heartbeat continues while Orchard's pane is open.
30. As the operator, I want a sweep to report stale threads and the state of every worker, so that I know what needs attention.
31. As the operator, I want my charter to decide what a sweep scans beyond Orchard's ledger and workers, and how often, so that the sweep matches how I work.
32. As the operator, I want Orchard to use every tool I have connected (MCPs, skills, `gh`, `gcx`, environment variables), so that it can reach anything I can.
33. As the operator, I want a capability map in `~/orchard` that says which tool serves which need and where credentials live, so that Orchard does not rediscover its tools after every restart.
34. As the operator, I want the capability map to record where credentials live but never the secrets, so that nothing sensitive sits in Orchard's files.
35. As the operator, I want Orchard to act without asking, including Slack posts, Jira comments and merges, so that work does not wait on me.
36. As the operator, I want my charter to carry my priorities, people and preferences, so that Orchard's judgment is mine.
37. As the operator, I want the charter to stay private in `~/orchard`, so that my life does not end up in the apple-pi repository.
38. As the operator, I want Orchard's procedures to come from a packaged skill, so that improvements to apple-pi reach Orchard without editing my charter.
39. As the operator, I want the skill to load only in Orchard, so that other sessions do not act like a chief of staff.
40. As the operator, I want `~/orchard` to be a local git repository that Orchard commits to, so that I can see what changed and undo a bad edit.
41. As the operator, I want to decide myself whether `~/orchard` gets a private remote, so that nothing leaves the machine unless I choose.
42. As the operator, I want Orchard to keep everything it knows in files it re-reads, so that I can restart Orchard at any time without losing context.
43. As the operator, I want a restarted Orchard to answer questions about threads from two weeks ago, so that its memory is longer than one session.
44. As the operator, I want Orchard to receive mail that arrived while it was closed when I next start it, so that worker reports are not lost.
45. As the operator, I want to talk to workers directly when I choose, so that Orchard is a convenience, not a gate.

## Implementation Decisions

- **Guidance, not control.** The skill and charter state goals and only the conventions other sessions depend on: where Orchard's state lives, how a worker reports back, how Orchard finds a worker. Orchard decides everything else: the directory or worktree for a worker, the wording of briefs, when to check in, how to judge staleness. No behavior is enforced in code, and no new code ships for Orchard v1.
- **Two artifacts.** apple-pi ships one `orchard` skill. The operator's home `~/orchard` holds a charter (`AGENTS.md`), a capability map, and Orchard's own ledger. The charter tells Orchard to load the skill.
- **Skill loading.** The skill is model-invoked with a narrow description that triggers only for the Orchard chief-of-staff session. It appears as one line in other sessions' skill catalogs; that cost was accepted over an explicit-only skill, whose file path would depend on the package's install location.
- **Identity.** An Orchard runs with its home as its working directory and a session id its charter names; this spec uses `~/orchard` and `orchard` as the example. The id is the mailbox address and mailboxes are shared across directories, so several Orchards (work, personal) need distinct ids. The skill refers to "your session id", not a fixed name.
- **Thread index.** Every thread is a ledger task in `~/orchard/.ledger`, created and moved with the ledger tools; the ledger's index is Orchard's index. Repo work gets a pointer task naming the repo ledger task the worker owns. The ledger tools write to the current directory's ledger, so workers own repo ledger tasks and Orchard owns the pointers.
- **Staleness.** When a due date or follow-up date exists, Orchard notes it in plain words in the thread's `task.md`. Orchard judges staleness from those notes and the task's `Updated` date. There are no fixed header lines.
- **Workers.** Orchard picks each worker's session id and name, writes the brief to a file, and starts the worker in a new tmux window as `pi --session-id <id> --name <name> @<brief file>`. Pi reads an `@file` argument as prompt text and expands a leading `~` (`cli/file-processor.js` through `utils/paths.js` in the installed package). Because of the mailbox's startup rule, mail already waiting for the worker rides this first prompt instead of making Pi reject it.
- **Finding a worker.** With the session id, Orchard reads the worker's tmux state record (`busy`, `idle` or `waiting`; see `docs/tmux-sessions.md`), its mailbox, its session file, and its repo ledger task.
- **Reporting.** Every brief asks the worker to `mailbox_send` to the Orchard's session id (`orchard` in this spec's example) when it finishes or is blocked, and to keep its repo ledger task current. Orchard redirects a worker with `mailbox_send` to the worker's id.
- **Finished workers.** Orchard summarizes the result to the operator and keeps the worker's window open until the operator acknowledges it, then closes the window. The worker's session file remains, so the session can be reopened by id.
- **Heartbeat.** After each sweep, Orchard uses `schedule` to set the next one. `schedule` is in-memory and root-only (`docs/scheduling.md`), so the heartbeat stops when Orchard's pane closes. That is accepted for v1. The charter sets the cadence and the sources a sweep scans beyond Orchard's ledger and workers.
- **Autonomy.** Orchard acts without approval, including actions that speak as the operator outside the machine. The charter carries the judgment.
- **Access.** Orchard may use every connected MCP, skill, CLI and environment variable. The capability map records which tool serves which need and where credentials live, never the secrets themselves.
- **History.** `~/orchard` is a local git repository. Orchard commits changes to its ledger, charter and capability map. A remote is the operator's choice.
- **Setup of `~/orchard`** happens with the operator: the charter's content is his judgment, not apple-pi's.

## Testing Decisions

- Good tests check behavior someone can observe, not the wording of guidance. There are no phrase tests that repeat the skill's text.
- **Confirmed seam A (CI):** the existing package-load test (`tests/package-load.mjs`) asserts that the `orchard` skill is packaged, loads without diagnostics, has a directory name that matches the skill name, and is model-invoked. Prior art: the same test's packaged-skill inventory and invocation-policy checks.
- **Confirmed seam B (live acceptance run, not in CI):** one recorded run of a real Orchard session in a scratch tmux server (`tmux -L <name> -f /dev/null`), with temporary `PI_MAILBOX_DIR`, `PI_TMUX_STATE_DIR` and Orchard home, so it touches none of the operator's real state. The run drives acceptance criteria 1 to 5 in [task.md](task.md#acceptance-criteria) and checks the results on disk: ledger tasks and pointers, the worker's tmux window and state record, mailbox lines in both directions, an answer after an Orchard restart, and the scheduled next sweep. The run costs real model tokens and varies between runs; its record is kept in the task bundle as evidence.
- Modules tested: the `orchard` skill (A for packaging, B for its effect). No code module changes.
- A later TDD or implement invocation still needs its own fresh seam confirmation before it writes tests.

## Out of Scope

- New code: no Orchard extension, tool, launcher script, spawn helper or status command.
- A persistent or external clock (launchd, cron). The heartbeat is the in-pane `schedule` loop.
- An approval step for outward-facing actions.
- Fixed staleness fields, a separate index file, or a second thread format.
- Rules for worker directories or worktrees.
- Closing the startup race the mailbox task left open (a message arriving in the milliseconds between `session_start` and the host's own prompt).
- Content of the operator's charter and capability map beyond what Orchard needs to find the skill; that content is his.
- Remotes or backups for `~/orchard`.

## Further Notes

- Governing sources: `docs/tasks.md#session-mailbox` (mailbox contract, startup rule, at-least-once delivery), `docs/scheduling.md` (`schedule` limits), `docs/tmux-sessions.md` (state records), `docs/ledger.md` (ledger workflow).
- The design comes from the operator's description of the Codex "Dots" experience: one place to drop a goal, then come back to find it delegated, done and summarized. No external facts about that product are used.
- The `skill-authoring` skill governs how the `orchard` skill is written.

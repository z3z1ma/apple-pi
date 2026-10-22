# Specification: interns, peers, and the digital workplace

Governing task: [task.md](task.md) (decisions 1 to 11). The operator also approved, in conversation on 2026-10-21, how a busy attached peer, intern processes, intern models, headless peers, and the pair's second opinion work; this specification records those choices under Implementation Decisions. Approved proposal: [proposal-workplace.md](proposal-workplace.md) (items 1 to 24, A to E). Next: the tickets in `tickets/` break this specification into slices; the operator reviews both before any implementation.

Terms: a **person** or **peer** is a lasting top-level Pi session in an organization ([docs/organization.md](../../docs/organization.md)); the **runtime** is the session-state daemon and its database ([docs/session-state.md](../../docs/session-state.md)); an **intern** is one of the two one-shot reading tools, `explore` and `research`.

## Problem Statement

The operator runs his work through an organization of lasting people, but the harness still carries a second, older delegation system built for something else. The subagent `agent` tool, with its background runs, resume, steering, nesting, clarification, coding children, custom definitions, and a live team view, duplicates what peers now do, costs memory (one root process held 37 finished builders for three days), and has lifecycle problems of its own. Its child sessions also leak into the runtime as `child` rows that no view shows.

The people themselves talk through machinery-named tools (`mailbox_send`, `*_peer_session`). Mail goes to one person, with no threads, replies, copies, team discussion, meetings, or escalation, so the organization cannot behave like a human one. And the work a person does is guessed, not given: the "current task" is whichever ledger bundle it last touched, and the "intent" is a cheap model's guess after each turn. Nobody can see who is on what, who is free, or what nobody owns, and work outside the ledger has nowhere to keep its goal or context.

## Solution

1. Two **interns**, `explore` (the local repository and filesystem) and `research` (external sources), are the only one-shot model helpers a person has. Each is a first-class tool that runs a headless Pi process, shows a live activity line, returns one summary, and exits. Their descriptions frame them as handing a question to a cheap intern, with the benefits, caveats, and risks that come with it.
2. The subagent system goes: the `agent` tool and its result, steer, and stop tools, the manager, custom agent definitions, nesting, `clarify`, coding children's review and notebook access, the team view, and child rows in the runtime. `/btw` keeps working and owns its one session directly. The pair's hidden consultant is replaced by asking the organization for a second opinion.
3. **`pi_exec` model workers run on peers.** A program can attach existing peers by name, or start ephemeral peers in a role, one per call or held as a handle; ephemeral peers are discarded when their call or the execution ends. A call returns what the model writes, as prose or a typed value.
4. People get one coherent set of **workplace tools** named for human actions, built on one model: every exchange is a **thread** whose messages are pushed (arrive as a turn) or pulled (wait to be read). Mail, replies, team channels, meetings, escalation, a directory, reminders, and the managers' hire-to-let-go tools all work this way. The operator is a person at the top of every tree whom anyone can mail.
5. **Work is assigned, not inferred.** Every piece of work is a task bundle with a `task.md` goal: a ledger task, or an ephemeral task in the state directory. A person holds tasks someone assigned (or that it took), with one in focus. Hiring is assigning. The goal is in the person's context. Each task has a thread. The views show focus, the available, and the backlog.
6. Agent World projects all of it: letters, a meeting room, notice boards, escalation walking to the operator's desk, a task board in the headquarters, ephemeral tasks as notes in team rooms, carried quests, and assigning by handing a quest to a character.

## User Stories

### Interns

1. As a person, I want an `explore` tool, so that I can find out where something is in the repository without reading it all into my own context.
2. As a person, I want a `research` tool, so that I can get answers from external sources without filling my context with pages.
3. As a person, I want each intern tool's description to say it is a cheap intern, so that I know when one is the right call.
4. As a person, I want the description to say the summary is lossy and only what the intern chose to report, so that I verify a finding before I act on it.
5. As a person, I want the description to say interns can miss, misread, or state a belief as fact, so that I read the source myself when the detail decides the outcome.
6. As a person, I want several intern calls in one reply to run in parallel, so that I can fan out reading without a background system.
7. As the operator, I want a live activity line (the intern's current tool and argument) while it works, so that I can see it is making progress.
8. As the operator, I want Esc to stop an intern's process at once, so that a wrong question costs nothing more.
9. As the operator, I want an intern's process to exit when it answers, so that nothing stays in memory.
10. As a maintainer, I want interns to run on the same headless runner `pi_exec` workers use today, so that there is one implementation of a one-shot run.
11. As a maintainer, I want interns to keep the `quick` model profile, so that their model is configured where machinery models are, not in a role.
12. As a maintainer, I want one measurement of an intern's startup latency in the evidence, so that we know what a call costs.

### Removing subagents

13. As a person, I want no `agent`, `get_subagent_result`, `steer_subagent`, or `stop_subagent` tools, so that cross-agent work goes through peers and nothing else.
14. As a person, I want no `<subagent-team>` prompt section, so that my prompt does not advertise a team that no longer exists.
15. As the operator, I want custom agent definitions (`.pi/agents`, `.agents/agents`, `~/.pi/agent/agents`) no longer loaded, so that roles are the only way to define a kind of person.
16. As the operator, I want `~/.pi/agent/agents/grafana-debugger.md` deleted, so that no dead definition is left behind.
17. As a maintainer, I want the subagent manager, in-process child runner, background lane, resume, steering, nesting, and `clarify` deleted, so that memory and lifecycle problems go with them.
18. As a maintainer, I want coding children's completion review and add-only notebook access deleted, so that the notebook and change reflection serve root sessions only.
19. As the operator, I want the Agents tab, the active-agent widget, the agent count on the input card, and the conversation viewer gone, so that the work panel shows tasks and programs only.
20. As a maintainer, I want no `child` session rows written to the runtime, so that every row is a person or a session the views can show.
21. As a maintainer, I want the `inChildSessionContext` checks removed wherever no in-process child remains to need them, so that extensions stop paying for a mechanism that is gone.
22. As the operator, I want `/btw` to keep working as before, so that I keep my private side conversation.
23. As a maintainer, I want `/btw` to hold its one session directly, with no manager, so that it does not keep the subagent system alive.
24. As a maintainer, I want the skills that fan out `agent` sessions rewritten to use interns, peers, or `pi_exec`, so that no skill names a tool that does not exist.

### The pair's second opinion

25. As the pair programmer, I want `ask_for_second_opinion(question, to?)`, so that I can get an independent view from the organization instead of a hidden run.
26. As the pair programmer, I want the question to go to the main session's manager by default, so that the natural reviewer answers.
27. As the pair programmer, I want to name any person in the directory instead, so that I can ask the right specialist (for example the Chief Architect).
28. As the pair programmer, I want a read-only `directory`, so that I can choose whom to ask.
29. As the pair programmer of a session with no manager, I want to be required to name someone, so that the operator is never interrupted by default.
30. As the operator, I want a second opinion to reach me only when the pair names me, so that my attention is spent on purpose.
31. As the pair programmer, I want to be told when nobody in the organization can be asked, so that I go on with my own judgment.
32. As the main agent, I want the question and the answer to reach me in a thread I am in, so that nothing is hidden from me and I can join the discussion.
33. As the person asked, I want the mail marked as coming from that session's pair, so that I know who is asking and why.
34. As a maintainer, I want the consultant agent, the consultation context, the managed-subagent service, and the pair's escalation and gate code deleted, so that the pair has one way to get a second opinion.

### `pi_exec` on peers

35. As a person writing a program, I want to attach existing peers to a `pi_exec` call as named handles, so that a program can give work to colleagues who already know the area.
36. As a person writing a program, I want an attached peer's call to run as one turn in that peer's own session, so that the work lands in its transcript and memory.
37. As a person writing a program, I want a call to a busy attached peer to wait until it is idle, so that I never interrupt its own run.
38. As a person writing a program, I want a program never to close or retire an attached peer, so that attaching is safe.
39. As a person writing a program, I want `agent(role, task)` with no attached peer to start an ephemeral peer in that role, so that a program can use any kind of person from the catalog.
40. As a person writing a program, I want the role to set the ephemeral peer's model, so that minds come from roles as everywhere else.
41. As a person writing a program, I want a plain `agent()` call to close its ephemeral peer when it returns, so that a loop never piles up windows.
42. As a person writing a program, I want `peer(role)` to return a handle I can call several times and close, so that one ephemeral peer can work through several turns.
43. As a person writing a program, I want every ephemeral peer still open at the end of the execution discarded, so that a failed or cancelled program leaves nothing running.
44. As a person writing a program, I want a call to return what the model writes, as prose, so that I get the answer, not a notification.
45. As a person writing a program, I want an `output_schema` call to return a validated typed value, so that programs can compose results.
46. As the operator, I want a discarded ephemeral peer's session record deleted, so that Ralph does not leave a hundred former members at the inn.
47. As the operator, I want a discarded ephemeral peer's transcript file kept on disk, so that a failure can still be read.
48. As the operator, I want an ephemeral peer to open a window in the calling session's tmux server while it works, so that I can watch it like any other person.
49. As a person outside tmux, I want ephemeral peers to run headless and still be peers in the runtime, so that programs work without a terminal.
50. As a maintainer, I want each ephemeral peer to get an ephemeral task holding its prompt, discarded with it, so that programs follow the same work model as people.
51. As a person, I want the review and Ralph programs to use roles from the catalog, so that they keep working with `builder` gone.
52. As the operator, I want Ralph to run one ephemeral peer per iteration, closed before the next, so that each iteration has fresh context.

### Threads and mail

53. As a person, I want every exchange to be a thread with a subject, participants, and ordered messages, so that conversations are durable and readable later.
54. As a person, I want `send_mail(to, cc?, subject, body)`, so that I can write to one or several people with copies.
55. As a person, I want `to` and `cc` to accept people, `my-team`, and `my-manager`, so that I can address a group the way I would in email.
56. As a person, I want `reply(thread, body)` to reach everyone in the thread, so that a conversation stays together.
57. As a person, I want each incoming message to show its thread id, subject, and sender, so that I can reply without a lookup.
58. As a person, I want `inbox()` to list my threads with what is new, so that I can catch up on what I have not read.
59. As a person, I want `read_thread(thread)` to show a thread in full, so that I can read its history before I answer.
60. As a person, I want mail sent to me while I am asleep to wait and arrive when I wake, so that nothing is lost (as mail works today).
61. As a sender, I want to be told when a recipient is asleep, so that I know my mail waits.
62. As a maintainer, I want threads stored by the runtime, the single writer, so that every view and tool reads one source.
63. As a maintainer, I want `mailbox_send` replaced, not kept beside `send_mail`, so that there is one way to write.

### Team channels

64. As a person, I want `post(channel, body)` in my team's channel, so that I can tell my team something without writing to each person.
65. As a person, I want channel messages pulled, so that a busy channel does not fill my context or interrupt my run.
66. As a person, I want a channel message that names me pushed to me, so that I still hear what is for me.
67. As a person, I want to read a channel with `read_thread`, so that channels work like any thread.
68. As a manager, I want my team's channel to include me and everyone under me, so that membership follows the tree.
69. As a person invited to another team's channel, I want to post there, so that cross-team work has a place.

### Escalation and the operator

70. As a person, I want `escalate(body)` to send to my manager, so that I can raise something beyond my authority.
71. As a manager, I want to escalate further up the chain, so that a decision reaches whoever can make it.
72. As a person at the top of a tree, I want `escalate` to reach the operator without blocking me, so that I keep working while he decides.
73. As the operator, I want to be a person in the directory, at the top of every tree, so that anyone can mail me like a colleague.
74. As the operator, I want mail to me to show as needing me in Agent World's Mail tab and in the sidebar, so that I see it where I already look.
75. As the operator, I want to reply to a thread from Agent World and the sidebar, so that my answer reaches every participant as a message, not as a prompt in someone's session.
76. As a person, I want `ask_user_question` to stay the way to interrupt the operator now, so that urgent questions still stop him.

### Meetings

77. As a manager, I want `meet(people, agenda)` to open a meeting thread, so that several people can work a question out together.
78. As a meeting participant, I want every meeting message pushed to me, so that the meeting moves at conversation speed.
79. As a meeting organizer, I want `end_meeting(thread, summary)` to send the summary to everyone and close the thread, so that the meeting ends with a record.
80. As the operator, I want no cap on meeting rounds, so that the organizer decides when it is done.

### The directory and manager tools

81. As a person, I want `directory` to list everyone in my organization with name, title, team, manager, what they work on, and whether they are working, idle, or asleep, so that I know whom to ask.
82. As a person, I want former members in the directory on request, so that I can find who did something before.
83. As a person, I want each person's track record (tasks assigned and finished) in the directory, so that I pick colleagues by what they have done.
84. As a manager, I want `hire(role, name?, goal)`, so that I bring someone in with a written goal.
85. As a manager, I want `rehire(person, goal?)`, so that I bring back someone who knows the area.
86. As a manager, I want `send_home(person)`, so that someone sleeps without leaving.
87. As a manager, I want `let_go(person, reason)`, so that someone leaves the organization with a reason on record.
88. As a manager, I want `move(person, manager)`, so that I can change someone's team.
89. As a manager, I want `rename(person, name)`, so that I can change a name badge.
90. As a person, I want `remind_me(when, text)`, so that I can follow up later without remembering.
91. As a maintainer, I want the six `*_peer_session` tools, `list_peer_sessions`, and `schedule` replaced by these names with the same behavior, so that there is one tool per action.

### Workplace extras

92. As a new hire, I want my first turn to include my team channel's recent history, so that I start with the team's context, as a new colleague reads the channel on day one.
93. As a manager, I want `let_go` to first ask the person to post a handover in the team channel, so that what they knew stays with the team.
94. As a manager, I want my charter to suggest a recurring short standup through `remind_me` and `meet`, so that I can hold one when my team needs it.

### Assignments and tasks

95. As a person, I want my work to be tasks someone assigned to me, so that what I do is decided, not guessed.
96. As a person, I want to hold several assigned tasks with one in focus, so that I can juggle work the way people do.
97. As a person, I want `focus(task)`, so that I can switch what I work on now.
98. As a person, I want `finish_task(outcome)` to write the outcome into the task, end my assignment, and tell whoever assigned it, so that finishing is one act.
99. As a manager, I want `assign(person, task)` with a ledger task, an ephemeral task, or a plain goal, so that I can give any work to anyone in my organization.
100. As a manager, I want `unassign(person, task)`, so that I can take work back.
101. As a manager, I want assigning work to someone asleep to wake them, so that assigned work starts.
102. As a manager, I want `hire(role, goal)` to create the task and assign it, so that nobody starts without a written goal.
103. As a person, I want `take_task(goal)` to create and take an ephemeral task, so that work I start on my own is still a task.
104. As a person in a session the operator started, I want to take the first request as my task before I start working, so that even the operator's own sessions say what they work on.
105. As a person, I want to take an unassigned task in my organization, so that I can pick up work nobody owns, and my manager sees it.
106. As a person, I want work with no ledger task to be an ephemeral task with the same shape (a `task.md` goal, room for context files, a retrospective), so that every piece of work has a place for its context.
107. As a person, I want ephemeral tasks kept in the state directory, so that they survive a reboot.
108. As a person, I want `promote_task` to move an ephemeral task into the project's ledger, so that work that turns out to matter becomes durable.
109. As a person, I want my focused task's `task.md` appended to my context when it is assigned or focused, so that my goal is in front of me.
110. As a person, I want the goal appended again after each compaction, so that I never lose it.
111. As anyone, I want editing `task.md` to be how a goal changes, so that the goal is one file, not a copy.
112. As a person, I want each task to have a thread with its assignees and whoever assigned them, so that the conversation about the work stays with it.
113. As a maintainer, I want the runtime to record each assignment (who, task, by whom, when, ended when), so that the record is exact and every view reads it.
114. As a maintainer, I want touching a ledger file to no longer bind work to a session, so that only assignments do; `history.json` keeps recording touches as a record.
115. As a maintainer, I want session-title's quick-model intent deleted, so that what a person works on is its focused task, not a guess.
116. As a person, I want people with no assignment shown as available in the directory, so that managers see who is free.
117. As a manager, I want unassigned live ledger tasks shown as a backlog, so that I see what nobody owns.
118. As the operator, I want the sidebar and dashboard to title each card by its focused task, so that I see what each person does.
119. As a person, I want a finished ephemeral task archived with its retrospective, so that its lessons feed the learnings even when nothing reached the ledger.

### Agent World

120. As the operator, I want mail to fly as a letter between characters, so that I see the organization talking.
121. As the operator, I want a meeting to gather its participants in a meeting room in the headquarters, so that I see who is meeting.
122. As the operator, I want each team room to have a notice board for its channel, so that I can read the channel in place.
123. As the operator, I want an escalation to me to walk to my desk, so that I notice it.
124. As the operator, I want ledger tasks on a task board in the headquarters, with the quest office left to Jira, so that the two kinds of work do not mix.
125. As the operator, I want ephemeral tasks as notes pinned in team rooms, so that I see informal work too.
126. As the operator, I want each character to carry its focused quest, so that I see what it works on at a glance.
127. As the operator, I want to assign work by handing a quest to a character, so that assigning is direct.
128. As the operator, I want the backlog on the task board, so that I see what nobody owns.

### Documentation

129. As a maintainer, I want the organization, session-state, and Agent World docs to describe threads, the workplace tools, and assignments, so that the contract is written down.
130. As a maintainer, I want the subagents doc replaced by an interns doc, so that it describes what exists.
131. As a maintainer, I want `docs/boundaries.md` to record the rejected ideas (custom agents, background subagents, pushed channels, assignment tickets beyond tasks, calendars), so that nobody restores them by accident.
132. As a maintainer, I want AGENTS.md and the README to reflect the new execution contexts and catalog, so that future agents have the right mental model.

## Implementation Decisions

### Interns

- `explore` and `research` are two tools registered for root sessions. Each takes the question (and, for `research`, optional material to read). Each runs one headless Pi process (`--mode json --print --no-session`, discovery off, an explicit extension list) on the one-shot runner `pi_exec` workers use today. The runner moves to one owner that the interns and `pi_exec` both import, or stays in `pi_exec` with the interns importing it; there is one implementation.
- Each intern has a fixed prompt (its old agent-type prompt), read-only built-in tools (no `edit`/`write`), and the `quick` profile. The tool streams the worker's current tool and argument as its live activity line and returns the final text.
- Tool descriptions and guidelines carry the intern framing (decision 9, proposal item 9): fast, cheap, and keeps reading out of your context; returns only what it chose to report, as a lossy summary; can miss, misread, or report a belief as fact, so verify findings before acting and read the source when the detail decides.
- The word "sense" is not used anywhere; the two tools are interns in prompts, tools, and docs.

### Removal

- Deleted: the `agent`, `get_subagent_result`, `steer_subagent`, and `stop_subagent` tools; the `<subagent-team>` and `<inference-profiles>` prompt sections as subagent machinery; the agent manager, in-process runner, background lane, group join and notifications, nested tools, `clarify`, completion reflection for children, coding-child notebook access, custom agent loading and settings (`.pi/subagents.json`), the Agents tab, the active-agent widget and count, and the conversation viewer.
- `/btw` keeps its behavior and holds one Pi session directly, with its own start, follow-up, stop, and discard.
- The bridge no longer reports child sessions; the runtime keeps the `kind` column for old rows.
- Each `inChildSessionContext` call site is removed when, after removal, no in-process child loads that module; `/btw` keeps whatever check its own loading needs.
- Agent types survive only as the interns' fixed prompts; there are no user or project definitions. `grafana-debugger.md` in the operator's agent directory is deleted (approved).

### The pair

- `ask_consultant` and the hidden consultant run are replaced by `ask_for_second_opinion(question, to?)` and a read-only `directory`. The mail is sent in the main session's name, marked as from its pair, to `to` or the main session's manager. With no manager and no `to`, the tool refuses and says to name someone; the operator is reached only when named. With nobody in the organization, it says so.
- The thread's participants are the main session and the person asked. The reply is pushed to the main session; the pair sees it in the trajectory it follows.

### `pi_exec` on peers

- `pi_exec` takes an optional input mapping program names to existing peers (session ids). Programs reach them as handles with `run(task, output_schema?)`.
- `agent(role, task, output_schema?)` starts an ephemeral peer in the role (catalog-checked), reporting to the calling session, runs one turn, returns, and closes it. `peer(role)` returns a handle for several `run` calls and `close()`. The old `type` and `profile` arguments are removed.
- A turn's result is the model's final reply text. With `output_schema`, the peer has a result tool for that turn (as workers have `pi_exec_return` today), and the value is validated against the schema.
- A call to a busy attached peer waits until it is idle, then runs as one turn.
- Ephemeral peers open a window in the calling session's tmux server; when the caller has no tmux, the runtime runs the peer headless (RPC mode), still connected through its bridge.
- Discarding an ephemeral peer closes it and deletes its session record (and its assignments and thread memberships); its transcript file stays. Every ephemeral peer still open is discarded when the execution ends, fails, or is cancelled.
- An ephemeral peer gets an ephemeral task holding its prompt, assigned to it, discarded with it.
- The review and Ralph programs and their skills use catalog roles (for example `implementation-engineer`, `code-review-specialist`) instead of `builder` and custom types.

### Threads

- The runtime stores threads: a thread (id, subject, kind: mail, channel, meeting, or task; created by; created at; closed at), its participants (session or operator, delivery: push or pull), and its messages (id, thread, sender, body, at). Mail delivery reuses today's mechanism: a pushed message is delivered as mail is now (queued for a sleeping person, recorded on disk when delivered, sent again on reopen).
- Tools for every person: `directory`, `send_mail`, `reply`, `inbox`, `read_thread`, `post`, `escalate`, `remind_me`, `update_self`, `explore`, `research`, and the task tools. Managers also have `hire`, `rehire`, `send_home`, `let_go`, `move`, `rename`, `meet`, `end_meeting`, `assign`, and `unassign`. The behavior of each manager tool matches the `*_peer_session` tool it replaces, with the goal and task additions below.
- `my-team` means everyone whose manager is the caller (for a manager) or the caller's teammates under the same manager; `my-manager` is the caller's manager.
- A team channel exists per manager, with the manager and its reports as pull participants; naming a participant (by name or id) in a post pushes it to them.
- `escalate` writes to the caller's manager; at a root it writes to the operator, which marks it needing him.
- The operator is a participant kind of his own. Mail to him sets the runtime's needs-you state for him; Agent World's Mail tab and the sidebar list his threads and send his replies as thread messages.
- Meetings push every message to every participant; `end_meeting` sends the summary and closes the thread.
- The `<org>` and `<manager>` charters teach the tools and the push/pull model, without adding boxes.

### Assignments and tasks

- The runtime stores assignments (session, task path, assigned by, at, ended at) and each person's focused task. Only assignments bind work to a person; the bridge's `currentTask` from ledger touches is removed; `history.json` touch records stay.
- Ephemeral tasks live under the state directory, one bundle per task with `task.md` and `retrospective.md`, created by the runtime or the task tools; finished ones are archived there. `promote_task` moves a bundle into the project's `.ledger/` with an index row, as `ledger_add` creates one.
- `take_task`, `assign`, `unassign`, `focus`, `finish_task`, and `promote_task` are tools. `hire` and `rehire` take a goal that becomes a task. A session the operator started is told (in `<org>`) to take its first request as a task before working.
- On assignment, focus, and after each compaction, the bridge appends one message with the focused task's `task.md` (append-only, as the notebook packet is).
- Each task has a thread (kind `task`) with its assignees and assigner as push participants; `finish_task` posts the outcome there.
- session-title's intent request and the `intent` fact are deleted; the views read the focused task.
- `directory` shows each person's tasks, focus, track record (assignments finished), and "available" when it holds none; unassigned live ledger tasks are the backlog.

### Agent World

- The backend projects threads (letters between characters, meetings, channels), escalations, assignments, the backlog, and ephemeral tasks; the web layer draws them: letters fly, a meeting room in each headquarters, a notice board per team room, the escalation walk, a task board in the headquarters (ledger tasks and backlog), notes in team rooms (ephemeral tasks), a carried quest, and assigning by handing a quest over. Theme words come from each theme pack.

## Testing Decisions

- Tests assert observable behavior at the confirmed seams, not internals: what a tool returns, what another session receives, what the runtime database holds, what a view shows.
- Confirmed seams:
  1. Faux Pi sessions with the bridge against a spawned runtime (session-state test helpers): threads, channels, meetings, escalation, the directory, manager tools, assignments, tasks, and the second opinion.
  2. A `pi_exec` program run in a faux session, with a scratch tmux server and a fake `pi` on PATH (the pattern of Agent World's hire tests): attached peers, ephemeral peers, typed results, windows closing, records deleted, headless runs.
  3. The intern tools with a fake worker `pi` (the pattern of today's `pi_exec` worker tests): final text, activity line, process exit, Esc.
  4. Views: sidebar and dashboard pytest against a migrated database; the Agent World backend over a real runtime; headless-Chrome world tests.
  5. Surface: the package-load test asserts which tools exist and which are gone.
- Prior art: `components/session-state/tests/` (organization, mail, attention, subagents), `components/pi-exec/tests/pi-exec.test.ts`, `apps/agent-world/tests/backend.test.ts` and `world-recruit.test.ts`, `components/tmux-sessions/sidebar/tests/`, `tests/package-load.mjs`, and the pair's offline harness for the second opinion.
- Tests of removed behavior are deleted with it; no test asserts a discarded approach.

## Out of Scope

- Changing roles, the role catalog, souls, or selves beyond teaching the new tools.
- Read receipts, reactions, typing indicators, status emoji, and calendars with time slots (proposal "What it deliberately leaves out").
- Assignment tickets or hand-off records beyond tasks and their threads.
- Pushing every channel message.
- Rehydrating or migrating old subagent child transcripts.
- Publishing, pushing, or changing the operator's running sessions; moving his live organization onto the new tools is a separate step after the work lands.

## Further Notes

- The runtime is a long-lived daemon that keeps old code until it is restarted; every new column or table is read by views only when `pragma_table_info` (or the table list) shows it, as for the organization's columns.
- Request context stays append-only: goals, onboarding history, and pushed messages are appended, never rewritten.
- The operator's earlier decisions stand: roles never change; nobody is deleted except discarded ephemeral peers; mail is open across the whole organization while the tree carries assignment, reporting, and escalation; the only standing goal is to say what you verified and what you believe.

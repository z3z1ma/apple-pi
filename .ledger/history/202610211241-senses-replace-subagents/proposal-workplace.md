# Proposal: a digital workplace for people (decision 7)

Status: items 1 to 12 and A to E approved by the operator, 2026-10-21, with the intern framing of item 9. Items 13 to 24 (assignments) approved the same day, with item 24 adjusted: ledger tasks live in the headquarters, since the quest office holds Jira. Decision numbers refer to [task.md](task.md); "person" and "organization" are defined in [docs/organization.md](../../docs/organization.md), and mail and the runtime in [docs/session-state.md](../../docs/session-state.md).

Next: the operator settles or adjusts each item; the settled set goes into this task's specification and tickets, with decisions 1 to 6.

Idea: a person in the organization works the way a person in a remote software company does. They look people up, write to them, talk in threads and team channels, meet, escalate, keep notes, set reminders, and look things up. Managers also hire, move, send home, and let go. Every tool is named for the human action, not the machinery. A tool belongs here only if a human in a digital workplace has the same thing.

## One model under all of it: threads

Every exchange is a **thread**: a subject, its participants, and its messages in order, stored by the session-state runtime. Mail, replies, team channels, and meetings are threads that differ in only two things: who is in them, and whether a new message is **pushed** to a participant (it arrives as a turn, like mail today) or **pulled** (it waits until the participant reads it). Push costs the receiver context and attention, so only what a human would be interrupted by is pushed.

| Kind | Participants | Delivery |
| --- | --- | --- |
| Mail | the people you write to, plus copies | pushed |
| Reply | everyone in the thread | pushed |
| Team channel | everyone under one manager, plus the manager | pulled; a message that names you is pushed |
| Meeting | the people invited | pushed, until the organizer ends it |

## The tools

### Everyone

1. `directory`: everyone in your organization, with name, title, team, manager, what they work on now, and whether they are working, idle, or asleep. Former members on request. Replaces `list_peer_sessions`.
2. `send_mail(to, cc?, subject, body)`: starts a thread; `to` and `cc` take people, `my-team`, or `my-manager`. Replaces `mailbox_send`.
3. `reply(thread, body)`: answers everyone in a thread. Incoming messages show their thread id, subject, and sender, so replying needs no lookup.
4. `read_thread(thread)` and `inbox()`: read a thread in full, or list the threads you are in with what is new. This is how pulled messages are read.
5. `post(channel, body)`: writes in your team's channel, or a team you were invited to. Naming someone pushes the message to them.
6. `escalate(body)`: sends to your manager, who may escalate further. At the top of the tree, the operator is everyone's boss: escalating there puts it in front of the operator (needs you) without blocking anyone. `ask_user_question` stays the "walk to his desk now" path.
7. `remind_me(when, text)`: the existing `schedule` under a human name, available to every person.
8. `update_self`: unchanged, the person's own notebook.
9. `explore` and `research`: the two interns (decisions 2 and 9), framed to the model as handing a question to a cheap intern. The benefits: it is fast and cheap, and its reading stays out of your context. The caveats: you get back only what it chose to report, and a summary loses detail. The risks: it can miss what matters, misread it, or report a belief as a fact, so verify a finding before you act on it, and read the source yourself when the detail decides the outcome.

### Managers too

10. `hire(role, name?, goal)`, `rehire(person, goal?)`, `send_home(person)`, `let_go(person, reason)`, `move(person, manager)`, `rename(person, name)`. They replace `start_peer_session`, `reopen_peer_session`, `close_peer_session`, `retire_peer_session`, `transfer_peer_session`, and `rename_peer_session`, with the same behavior.
11. `meet(people, agenda)`: opens a meeting thread. Each message is pushed to every participant, and everyone answers in the thread until the organizer calls `end_meeting(thread, summary)`, which sends the summary to everyone and closes the thread. There is no cap on rounds; the organizer decides when it is done.

### The operator

12. The operator is a person in the directory: the boss at the top of every tree. People can mail him like anyone else. His mail appears in Agent World's Mail tab and the sidebar as needing him, and he replies there. His replies reach the thread as messages, not as session prompts.

## What it deliberately leaves out

- **Tickets or assignment records.** A goal is a mail; the ledger tracks work. (The organization specification rejects a hand-off schema: [spec.md, "No handoff schema"](../history/202610202140-organization/spec.md).)
- **Pushing every channel message.** Humans do not read every message in every channel as it arrives; neither do people here.
- **Read receipts, reactions, typing indicators, and status emoji.** Directory presence (working, idle, asleep) is enough.
- **Calendars with slots.** Agents have no hours; a reminder is enough.

## Where it lives

The runtime stores threads (tables for threads, participants, and messages; mail today is a command row). The bridge delivers pushed messages as it delivers mail now. Tools stay in `components/session-state/` (people and threads) and `components/organization/` (charters that teach them). Agent World's Mail tab and the dashboard read threads directly.

## Further, each optional

- **A. Onboarding.** A new hire starts with its team channel's recent history pulled into its first turn, and its manager's goal mail as the brief, the way a new colleague reads the channel on day one.
- **B. Hand-over on leaving.** `let_go` first asks the person to post a hand-over in the team channel (what is done, what is open, where things are), then retires them. A charter rule plus one turn, no new record.
- **C. Standups.** No tool: a manager's charter suggests a recurring `remind_me` that opens a short `meet` with its reports. Managers who do not need one do not hold one.
- **D. Track record in the directory.** `directory` shows each person's record (ledger tasks they touched, from `session_tasks`), so people pick colleagues by what they have done, not only by title.
- **E. Agent World projects the workplace.** Mail flies as a letter between characters; a meeting gathers its participants in a meeting room in the headquarters; a channel is a notice board in the team room; an escalation to the operator walks to his desk.

## Assignments: work is assigned, not inferred (proposed)

Today a session's "current task" is inferred: whichever ledger bundle it last touched (`currentTask` from the ledger's touch events), and its "intent" is a quick model's guess after each turn (session-title). Nobody gave it the work; the views guess what it does. Instead, every person holds work because someone assigned it, and every piece of work is a task with a `task.md` that states its goal.

13. **A person's work is a task, assigned.** A person holds zero or more assigned tasks and has one in focus. The runtime records each assignment (who, which task, assigned by whom, when, ended when). Only an assignment binds work to a person; touching a ledger file no longer does (`history.json` keeps recording who touched a bundle, as a record only).
14. **Every task is a bundle, durable or ephemeral.** A ledger task is `.ledger/<id>/`, as now. Work with no ledger task is an **ephemeral task** with the same shape (`task.md` as the goal, room for any context files, `retrospective.md`) under the state directory (`~/.pi/agent/state/tasks/<id>/`, so it survives a reboot, unlike `/tmp`). To the model the difference is one word: an ephemeral task is not in the project's ledger. `promote_task` moves an ephemeral task into the project's `.ledger/` when it turns out to matter.
15. **Hiring is assigning.** `hire(role, goal)` and `rehire(person, goal)` create the task from the goal (ephemeral unless a ledger task is named) and assign it. A new person never starts without a written goal.
16. **Managers assign.** `assign(person, task)` gives work (a ledger task id, an ephemeral task, or a goal that becomes a new ephemeral task); `unassign(person, task)` takes it back. Assigning work to someone who is asleep wakes them.
17. **People take work too.** In a session the operator started, the first request becomes the session's task: the model calls `take_task(goal)` (or names an existing task) before it starts working, so even the operator's own sessions say what they work on. Anyone may `take_task` an unassigned task in their organization; the manager sees it.
18. **Focus and finishing.** `focus(task)` switches which assigned task the person works on now. `finish_task(outcome)` writes the outcome into `task.md`, ends the assignment, and tells whoever assigned it, in the task's thread. A ledger task stays live until it is closed as now; an ephemeral one is archived with its retrospective.
19. **The goal is in the person's context.** When a task is assigned or focused, its `task.md` arrives as one appended message (append-only, so prompt caching holds), and again after each compaction, next to the notebook packet. The goal is the file itself: updating `task.md` is how anyone changes the goal.
20. **A task has a thread.** Each task has one thread whose participants are its assignees and whoever assigned them. Questions, progress, and the finish notice about that task go there, so the conversation about a piece of work stays with the work.
21. **Intent goes away.** What a person works on is its focused task's title, with the current state from `task.md`. The quick-model intent in session-title is deleted.
22. **The directory and the views show assignments.** `directory` lists each person's tasks and focus; a person with no assignment is "available". Unassigned live ledger tasks are the backlog, which managers see. The sidebar and dashboard title cards by the focused task.
23. **Programs use it too.** A `pi_exec` ephemeral peer gets an ephemeral task holding its prompt, discarded with it; an attached peer's call is a message in that peer's focused task thread.
24. **Agent World makes tasks objects.** Ledger tasks hang on a task board in the headquarters (the quest office stays Jira's); ephemeral tasks are notes pinned in the team room. Characters carry their focused quest. The operator assigns by handing a quest to a character, and the backlog is the board.

What this changes in behavior, as expected:

- Work becomes visible and countable: who is on what, who is free, what nobody owns.
- Managers balance load: they see the bench and the backlog without asking.
- Collaboration gathers around work: two people assigned to one task meet in its thread.
- Each record is exact: a track record lists tasks assigned and finished, not files touched.
- Context has a home: an ephemeral task bundle is where a person keeps notes, findings, and drafts for the work, and its retrospective feeds the learnings even when nothing reached the ledger.

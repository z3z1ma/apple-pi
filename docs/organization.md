# The organization

A Pi session is not a throwaway process. It is a **person**: a stable id, a human name, a role it cannot shake, a mind, a soul, a self, a record, a mailbox, and a place in an **organization**. The organization is a tree rooted at the session you start; managers hire from a **role catalog**, build teams of colliding perspectives, and bring in managers under them when their own attention would become the bottleneck. Everyone can read the whole directory and mail anyone in the organization; the tree carries only assignment, reporting, and escalation. Nobody is deleted: closing is sleep, retiring is leaving. The terminal is the organization; the [tmux sidebar](tmux-sessions.md) and [Agent World](agent-world.md) are its pictures.

This page is the product contract. The runtime mechanics (the database, the commands, the facts) are in [session-state](session-state.md); the self's place among the session's memories is in [context](context.md#the-self); the one-shot reading helpers are in [interns](interns.md).

## Terms

| Term | Meaning |
| --- | --- |
| Person | A root Pi session with a stable session id. `pi --session-id X` reopens the same person; `/fork` and `/clone` make a new one. Your own sessions are people too. |
| Organization | Every person whose chain of managers ends at one root. The **root** is a person with no manager. Two roots on one machine are two organizations. |
| Operator | The human. The operator is a person at the top of every organization, listed in the directory as `operator`, with no Pi session. Anyone can mail the operator. |
| Manager | A person whose role manages, or the root of an organization. Only managers hire, send home, call in, let go, rehire, rename, and move people, assign and unassign work, and hold meetings. |
| Role | A catalog entry: an obligation, what the role leaves to others, what it delivers, its mind, its tool posture, and whether it manages. Fixed for a person's whole life. |
| Mind | The role's ordered list of models and a thinking level; the first model the session's registry has is used. |
| Soul | Three fragments of the world (random encyclopedia articles) drawn at hire, outside any model, and left unexplained. Never edited. |
| Self | The person's account of itself in four parts (story, practice, commitments, colleagues), rewritten only in reflection. Never distilled, never capped. |
| Record | What the harness knows a person did: assignments and their outcomes, manager history, hire and leave dates. |
| Hire, send home, call in, let go, rehire, move | Start a new person with a role and a goal under a manager; stop its process (the person is at home); start a person at home again with its history; record that it has left the organization; bring a former member back; put it under another manager. Hiring and letting go change membership; sending home and calling in change only whether the person is at work. |
| Thread | One conversation: a subject, its participants, and its messages in order. Mail, team channels, meetings, and task discussions are all threads. |
| Push, pull | How a participant gets a thread's messages. A pushed message arrives as mail (a turn). A pulled message waits until the participant reads the thread. |
| Task | A bundle with a `task.md` goal: a ledger task in a project's `.ledger/`, or an ephemeral task in the state directory. A person works only on tasks assigned to it or taken by it. |
| Interns | `explore` and `research`: cheap, one-shot reading tools that return a lossy summary outside the caller's context. They are not people. |

## The person

**Identity.** The session id is the person. The name comes from the [session-title](context.md#session-titles) extension; a hired person's role title shows beside its name wherever the name shows. A role is set at hire (`hire` with `role`) or by hand (`pi --role <name>`), recorded in the person's own transcript at its first start, and re-applied at every later start; a stored role wins over a later flag. A session started without a role, such as your own, has none, and no soul.

**Mind.** At every start the role's mind is applied: the first model in its list that the registry knows, at the role's thinking level, recorded as the session's `model` fact. A person whose role names no model the registry has starts anyway and warns once. Minds are named by exact model id in the role file, never through a profile, so a role's mind is the same on every machine that has the model.

**Soul.** At its first start, a person with a role draws three random Wikipedia articles (`components/organization/src/soul.ts`) and keeps their titles, descriptions, and lead paragraphs. The soul is rendered under the role, unexplained: the person is told only that these are fragments of the world it came to this work with, that they are not instructions, and that their meaning is its own to find. It is stored with the role, shown as the three titles in the directory and on the person's card, and never edited. A start whose draw fails (offline) warns and draws at the next start. A soul from before fragments is drawn again.

**Self.** Four fields, each one kind of claim with its own standard of evidence:

| Field | Heading | Kind of claim | Standard |
| --- | --- | --- | --- |
| `story` | My story | Interpretive: who I am, my reading of my soul and of what has happened to me | Mine to decide; may be reread |
| `practice` | How I work | Descriptive: how I actually work | A source outside me for each claim: a correction, a review finding, an outcome, a colleague's words. Open contradictions stay, marked open |
| `commitments` | What I hold myself to | Normative: what I choose to hold to | None; a choice, which never widens what the person may do |
| `colleagues` | The people I work with | Relational: how each colleague reasons and how to work with them | What they did and said; need not match their own view |

Task status, receipts, and plans stay out; tasks and the ledger hold them. The person does not choose when to rewrite its self. The harness starts a reflection, a [forked continuation](forked-continuations.md) of the person's own conversation, after a run in which it finished a task (`finish_task`) and when its context is about to be compacted, before the detail behind its recent work is gone. In the fork the person calls `update_self` with the fields it changes (omitted fields stay), or leaves the self as it is. `update_self` outside a reflection is refused. A program's temporary peer does not reflect.

The `<self>` section shows the self as it stood at the session's start or its last compaction. A rewritten self reaches the conversation at once as one appended message (`Self: …`, expanded to the whole self), so the cached prompt prefix stays valid until the compaction rebuilds it. The self lives in the person's transcript and is reported to the runtime as the `self` fact (the fields as `##` sections), so the views show its headings. A self written before the four fields is ignored, and the first reflection writes a new one. The [notebook](context.md) keeps its own job, sourced learnings about the work; the self is the person's own account of itself and its colleagues.

Why it is built this way: every person runs on a few aligned models that converge on the same answers, so differences between people must be pushed in from outside and then kept. The soul is that push. It comes from outside any model, because a model asked to invent a character writes the most likely one, and it is left unexplained, because an unexplained seed keeps giving new readings where an explained one settles into one. The self keeps the difference: each reflection turns what happened into the person's reading of itself, which shapes what it does next. The person interprets its soul in its story. Its practice must come from evidence outside itself, because a model's account of its own behavior is unreliable, and corrections from others are the best evidence it gets. Its commitments carry what it chose across context windows. Its view of colleagues is its own, so disagreement between people survives. People differ in what they consider; the shared rules decide what counts as proof and what anyone may do.

**Record.** The directory (`directory`) shows every member of the caller's organization as one line: id, name, title, manager, status, availability (no held tasks), focus, and how many tasks it holds and has finished; on request (`former: true`) it adds when and why former members left. Asked for one `person`, it shows that member in full: role, team channel, working directory, soul, when it first started, held tasks with their files and threads, and every finished assignment with its outcome. The roster stays small however long the record grows. Managers also see the backlog: unassigned live ledger tasks in the organization's working directories, discovered without assigning them. Every manager change is kept (`manager_changes`). The record is public to the organization; Agent World's card shows the focused task and titles of finished tasks.

## The tree

A session started with `--reports-to <id>` has that session as its manager; a session with no manager is a root. The runtime owns the tree: the flag seeds the manager at the first hello and is ignored once the record holds one, a reopen keeps the recorded manager, and `move` is the only way to change it. Mail by id reaches any session on the machine, inside or outside the organization; the directory lists only the caller's organization. `/pi-sessions` still lists every live session for you.

Every root session's system prompt carries an `<org>` section: who it is, its id as its mail address, its manager and root, how the directory and mail work, and the norms (work, reports, and escalation follow the tree; a manager is never a relay; say what you verified and what you believe). A hired person is told to ask its manager for people it lacks and when to escalate. A manager also gets the `<manager>` charter (hire colliding perspectives, give independent thinkers the problem before the preferred answer, delegate whole outcomes, name disagreements, escalate by uncertainty times consequence, hire a manager under itself when fan-in would make it the bottleneck, reconcile against the directory, sweep) and the `<role-catalog>` section, one line per role. The charters are in `components/organization/src/charters.ts`.

## Workplace tools

Every root session has these tools. Each sends a command to the runtime or reads its database; the details are in [session-state](session-state.md#mail-and-threads).

| Tool | What it does |
| --- | --- |
| `directory` (`former?`, `person?`) | Lists the organization, one line per person with the operator at the top: name, id, title, manager, status, availability, focus, and held and finished counts; managers also see the backlog. `person` (a name or id) shows one person in full: held tasks, the record with outcomes, working directory, soul, and since when. The tool result's details keep the full structured projection. See [Record](#the-person). |
| `send_mail` (`to`, `cc?`, `subject`, `body`) | Starts a mail thread. Addresses are names, session ids, `operator`, `my-team`, and `my-manager`. Every participant is pushed each message. |
| `reply` (`thread`, `body`) | Answers everyone in a thread. In a team channel, the reply stays pulled except for people it names. |
| `inbox` (`all?`) | Lists threads with unread messages, or every thread with `all: true`. |
| `read_thread` (`thread`) | Shows a thread in full and marks it read. |
| `post` (`channel`, `body`, `invite?`) | Posts in a team channel. Posts are pulled; a post that names a participant is pushed to that person. |
| `escalate` (`body`) | Mails the caller's manager with the subject `Escalation`. At a root it goes to the operator. It does not block. |
| `remind_me` (`delay_seconds`, `text` or `command`) | Sends the caller a note, or starts a bash command, after a delay. See [scheduling](scheduling.md). |
| `update_self` (`story?`, `practice?`, `commitments?`, `colleagues?`) | Rewrites the named fields of the person's self. Accepted only in a reflection the harness starts. |
| `take_task`, `focus`, `finish_task`, `promote_task` | The task tools. See [Tasks and assignments](#tasks-and-assignments). |

## Manager tools

A root, and a person whose role manages, also has ten manager tools:

| Tool | What it does |
| --- | --- |
| `hire` (`role`, `goal`, `title`, `value?`, `cost_of_delay?`, `cwd?`, `name?`, `session_id?`) | Starts a new person in a role, reporting to the caller, with the goal assigned as a task before its first turn. |
| `call_in` (`person`, `goal?`, `value?`, `cost_of_delay?`) | Reopens a person at home with its history. A goal adds an assignment. Refused for a former member. |
| `rehire` (`person`, `goal?`, `value?`, `cost_of_delay?`) | Brings a former member back into the organization with its history. A goal adds an assignment. Refused for a member. |
| `send_home` (`person`) | Quits the person's process. The person sleeps and stays in the organization. |
| `rename` (`person`, `name`) | Renames a running person. Its id and history stay. |
| `move` (`person`, `manager`) | Puts a person, with everyone under it, under another manager of the same organization. |
| `let_go` (`person`, `reason`) | Asks the person for a handover, posts it in the team channel, then records why it left and closes it. |
| `assign` (`person`, `goal` and `title`, or `task`; `value?`, `cost_of_delay?`) | Gives a person a task or a written goal. It becomes the person's focus. |
| `unassign` (`person`, `task`) | Takes an assignment back without finishing it. |
| `meet` (`people`, `agenda`) | Opens a meeting thread. Every message is pushed to every participant. |
| `end_meeting` (`thread`, `summary`) | Sends the summary and closes the meeting. Only the organizer can end it. |

`person` and `manager` accept a name in the caller's organization or a session id. You can do the same acts from Agent World (hire at a manager's desk, give a goal to a person, let go from a person's actions). The details are in [session-state](session-state.md#manager-tools).

The `<org>` section teaches the push and pull model. A new hire's first turn includes its team channel's history, when the channel has any. The `<manager>` charter suggests a short regular meeting, arranged with `remind_me` and held with `meet`, when the team benefits from one.

## Threads

Every exchange is a thread that the runtime stores. Mail and meetings push every message to every participant. Team channels are pulled: a post waits until the participant reads it, unless the post names that person. Each task has a task thread for its assignees and assigners, also pushed. A pushed message to a person at home waits and arrives when the person wakes. The sender is told who is asleep.

Each manager has a team channel, `team:<manager-id>`, for the manager and its direct reports. Members follow the tree. An invited reader stays when its reporting line changes. Former members leave every channel.

## Tasks and assignments

Work is explicit. Hiring creates and assigns a task before the person's first turn; calling a person in or rehiring it without a new goal preserves its work, while a new goal adds an assignment and becomes its focus. `take_task` takes a written `goal` with a short `title` (creating an ephemeral task whose `task.md` heading is the title) or an existing `task` (its id or ledger path). A goal without a title is refused: the goal is too long to name the task wherever it is listed. Managers use `assign(person, goal and title, or task)` and `unassign(person, task)`. An assignment records who gave whom what, when, and how it ended; assigning a person at home opens its session and starts the work. A wake failure reports that the assignment was saved, so the manager can call the person in without duplicating it.

A person can hold several tasks, with one in focus. `focus(task)` rereads its `task.md`; the file is the goal, not a database copy. The goal is appended to context on assignment or focus, and again after compaction. Editing the file and refocusing brings its revision into context. Each task has a thread shared by its assignees and assigners; taking work also tells the person's manager there.

Ephemeral tasks live under the Pi state directory in `tasks/<id>/`, with `task.md`, `retrospective.md`, and any useful context files. They survive restarts. `finish_task(outcome)` writes the outcome, ends the focused assignment, clears focus, and posts the outcome in the thread. Once all assignees finish, an ephemeral bundle moves to `tasks/history/<id>/`, including its retrospective. Ledger tasks keep the ledger's separate status and archive workflow.

Only a root or a managing role can `assign` and `unassign`, and only inside its own organization. The operator can assign anyone. `take_task` with an existing task works only when nobody else holds that task.

`promote_task(task)` moves a live ephemeral bundle into its project's `.ledger/`, through the same index transaction as `ledger_add`. Files, assignment identity, and thread stay together. Its heading supplies the ledger title and summary; optional `title` and `description` can name it more clearly. The runtime alone writes assignments and focus. Editing a ledger bundle still records a transcript pointer in `history.json`, but never assigns work. Archiving a registered ledger task updates its bundle path without ending assignments or changing their identity. Views read the explicit focus, never old inferred intent or ledger touches.

## The role catalog

A role is a Markdown file: front matter (`title`, `mandate`, `models`, `thinking`, `writes`, `manages`) and a body that is the role's obligation, what it is not responsible for, how it works, and what it delivers, ending with the one standing rule: say what you verified and what you believe. The catalog is the package's `roles/` directory, then `~/.pi/agent/roles/`, then `<cwd>/.pi/roles/`, a later file replacing an earlier one of the same name. A malformed file is reported by path and skipped. Managers see the whole catalog in their prompt and hire by name.

The package ships thirty-two roles. `advises` means the role has no `edit` or `write` tool: it reads, runs, and reports, and someone who writes carries its findings into code.

| Role | Title | Mandate | Mind, in order | Thinking | Posture |
| --- | --- | --- | --- | --- | --- |
| `accessibility-specialist` | Accessibility Specialist | Find keyboard, screen reader, semantic, inclusive failures | `openai/gpt-6.1-sol`, `anthropic/claude-sonnet-5-5` | medium | advises |
| `architecture-prosecutor` | Architecture Prosecutor | Build the strongest evidence that the design is wrong | `anthropic/claude-opus-5-5`, `openai/gpt-6-astra` | high | advises |
| `chaos-engineering-specialist` | Chaos Engineering Specialist | Design failure injection, partial outage, retry, degradation | `openai/gpt-6.1-sol`, `anthropic/claude-sonnet-5-5` | medium | advises |
| `chief-architect` | Chief Architect | Judge boundaries, invariants, evolution, coherence | `anthropic/claude-opus-5-5`, `openai/gpt-6-astra` | high | advises |
| `code-review-specialist` | Code Review Specialist | Find real defects, regressions, maintainability problems in diffs | `openai/gpt-6.1-sol`, `anthropic/claude-sonnet-5-5` | medium | advises |
| `coordinator` | Coordinator | Chief of staff for the operator; runs the org, keeps threads, sweeps | `openai/gpt-6.1-sol`, `anthropic/claude-opus-5-5` | high | manages, writes |
| `database-reliability-architect` | Database Reliability Architect | Attack migrations, locking, isolation, corruption, rollback | `anthropic/claude-opus-5-5`, `openai/gpt-6.1-sol` | high | advises |
| `developer-experience-lead` | Developer Experience Lead | Judge APIs, naming, errors, docs, integration friction | `antigravity/gemini-3.8-flash`, `openai/gpt-6.1-sol` | medium | advises |
| `director-of-engineering` | Director of Engineering | Route work, set decision gates, resolve conflicts, own delivery | `openai/gpt-6.1-sol`, `anthropic/claude-opus-5-5` | high | manages, writes |
| `distinguished-member-of-technical-staff` | Distinguished Member of Technical Staff | Widen the solution space before the org commits | `anthropic/claude-fable-5-1`, `anthropic/claude-opus-5-5`, `openai/gpt-6-astra` | high | advises |
| `distributed-systems-researcher` | Distributed Systems Researcher | Attack consistency, concurrency, fault, and recovery assumptions | `anthropic/claude-fable-5-1`, `openai/gpt-6-astra` | high | advises |
| `end-user-customer-advocate` | End-User Customer Advocate | Protect the user from engineering convenience | `openai/gpt-6-astra`, `anthropic/claude-opus-5-5` | high | advises |
| `implementation-engineer` | Implementation Engineer | Make bounded, tested changes with no extra scope | `openai/gpt-6.1-sol`, `openai/gpt-6-luna` | medium | writes |
| `infrastructure-cfo` | Infrastructure CFO | Price decisions in spend, hours, lock-in, maintenance | `xai/grok-4.7`, `openai/gpt-6.1-sol` | medium | advises |
| `maintainer-from-three-years-ahead` | Maintainer From Three Years Ahead | Judge comprehensibility, upgrade cost, operational burden | `openai/gpt-6.1-sol`, `anthropic/claude-sonnet-5-5` | medium | advises |
| `new-team-member` | New Team Member | Read a document cold and say whether it teaches | `antigravity/gemini-3.8-flash`, `openai/gpt-6.1-sol` | medium | advises |
| `paradigm-outsider` | Paradigm Outsider | Solve it without the current stack or conventions | `anthropic/claude-fable-5-1`, `openai/gpt-6-astra` | high | advises |
| `performance-engineering-lead` | Performance Engineering Lead | Find complexity, tail latency, contention, limits | `openai/gpt-6.1-sol`, `anthropic/claude-opus-5-5` | medium | advises |
| `principal-engineer` | Principal Engineer | Turn a design into a plan grounded in the repository | `openai/gpt-6.1-sol`, `anthropic/claude-sonnet-5-5` | medium | advises |
| `principal-site-reliability-engineer` | Principal Site Reliability Engineer | Ask what fails at 3 a.m. and how it recovers | `openai/gpt-6.1-sol`, `anthropic/claude-sonnet-5-5` | medium | advises |
| `principal-ux-researcher` | Principal UX Researcher | Form usability, mental-model, and discoverability hypotheses | `anthropic/claude-opus-5-5`, `openai/gpt-6-astra` | medium | advises |
| `quality-engineering-director` | Quality Engineering Director | Find missing test dimensions; turn risk into checks | `openai/gpt-6.1-sol`, `anthropic/claude-sonnet-5-5` | medium | advises |
| `release-engineering-lead` | Release Engineering Lead | Plan rollouts, rollback, flags, compatibility | `openai/gpt-6.1-sol`, `anthropic/claude-sonnet-5-5` | medium | writes |
| `repository-archaeologist` | Repository Archaeologist | Dig out hidden assumptions, prior art, conventions | `anthropic/claude-haiku-5-5`, `openai/gpt-6-luna` | low | advises |
| `scientific-skeptic` | Scientific Skeptic | Separate fact from assumption; design the cheapest falsifying test | `openai/gpt-6-astra`, `anthropic/claude-fable-5-1` | high | advises |
| `skeptical-first-time-user` | Skeptical First-Time User | Use the product with no knowledge of its internals | `xai/grok-4.7`, `openai/gpt-6-luna` | low | advises |
| `staff-engineer-simplicity` | Staff Engineer, Simplicity | Remove accidental complexity without losing correctness | `openai/gpt-6.1-sol`, `anthropic/claude-sonnet-5-5` | medium | advises |
| `staff-security-engineer` | Staff Security Engineer | Threat-model trust boundaries, authorization, exposure, abuse | `anthropic/claude-opus-5-5`, `openai/gpt-6-astra` | high | advises |
| `technical-due-diligence-partner` | Technical Due Diligence Partner | Find hidden dependencies, migration traps, irreversible commitments | `anthropic/claude-opus-5-5`, `openai/gpt-6-astra` | high | advises |
| `technical-writer` | Technical Writer | Keep decision records, references, handoffs, runbooks | `antigravity/gemini-3.8-flash`, `openai/gpt-6-luna` | low | writes |
| `test-and-ci-operator` | Test and CI Operator | Run checks and report failures exactly | `anthropic/claude-haiku-5-5`, `openai/gpt-6-luna` | low | advises |
| `vp-of-product` | VP of Product | Ask whether this is the right thing to build | `openai/gpt-6-astra`, `anthropic/claude-opus-5-5` | high | advises |

The two managing roles differ in principal: a `coordinator` is your chief of staff, started once in its own directory with its own id (`pi --role coordinator --session-id coordinator` in `~/coordinator`) and kept for good; a `director-of-engineering` is hired under a root or another manager to run a team. Both hire from the same catalog.

## Processes

The packaged skills are the organization's handbook: roles are its jobs, and skills are its processes. A process skill names the perspectives the work needs (each with a default role), who chairs it, the handoffs and the threads that carry them, the points where the operator signs off, and what done means. Roles own how a person thinks; skills own how people work together. `skills/handbook-writing/` is the guide for writing both.

Processes staff with standing people first: people with matching experience, called in from home, and hired only when nobody fits. The coordinator holds the standing teams; a working session staffs a process with its own manager tools, or asks its manager for the perspectives. The operator takes part at the named sign-off points and reads everything else in threads.

## Rules of the organization

- Roles never change. A person who needs another role is a new hire; the old one sleeps or retires.
- Nobody is deleted. `send_home` sends the person home (it keeps its id, transcript, self, and record); `let_go` records when and why it left, and a manager can `rehire` it. The only exception is a temporary peer of a `pi_exec` program, whose record is deleted when the program discards it ([exec](exec.md#peers-and-schemas)).
- The tree carries assignment, reporting, and escalation; it does not gate mail. A manager that only forwards mail is a relay, which the charter forbids.
- There is no handoff schema. People give each other goals and say what they verified and what they believe.
- There are no caps: not on team size, self length, or the catalog. Managers size teams with judgment, and the charter names the one signal to watch (fan-in).

## Where it lives

| Piece | Owner |
| --- | --- |
| Roles, minds, souls, the self tool, the charters, and the directory | `components/organization/` (`roles.ts`, `soul.ts`, `self.ts`, `charters.ts`, `directory.ts`, `install.ts`), installed by `extensions/session-state.ts` in every root session |
| The workplace tools | `components/session-state/src/`: `mail.ts` (mail, channels, escalation), `meetings.ts`, `peers.ts` (the directory), `coordinator.ts` (manager tools), and `work-tools.ts` (task tools); `remind_me` in `components/tasks/` |
| Threads, assignments, and ephemeral tasks | the runtime: `threads.ts`, `channels.ts`, `work.ts`, and `runtime.ts` in `components/session-state/src/` |
| The package catalog | `roles/*.md` |
| The tree, the record, and the facts (`role`, `title`, `manages`, `soul`, `self`, `retired_at`, `retired_reason`) | the session-state runtime and database, [session-state](session-state.md) |
| The terminal views | [tmux-sessions](tmux-sessions.md): organizations as indented trees with role titles and folded former members |
| The picture | [agent-world](agent-world.md): headquarters per root, a team room per manager, cards, the hire form, retiring, former members at the inn |
| Interns | [interns](interns.md): `explore` and `research`, fixed prompts and the `quick` profile |

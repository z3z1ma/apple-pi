# The organization

A Pi session is not a throwaway process. It is a **person**: a stable id, a human name, a role it cannot shake, a mind, a soul, a self, a record, a mailbox, and a place in an **organization**. The organization is a tree rooted at the session you start; managers hire from a **role catalog**, build teams of colliding perspectives, and bring in managers under them when their own attention would become the bottleneck. Everyone can read the whole directory and mail anyone in the organization; the tree carries only assignment, reporting, and escalation. Closing is reversible dormancy; a completed permanent departure removes the live person and its raw session after a durable handoff. The terminal is the organization; the [tmux sidebar](tmux-sessions.md) and [Agent World](agent-world.md) are its pictures.

This page is the product contract. The runtime mechanics (the database, the commands, the facts) are in [session-state](session-state.md); the self's place among the session's memories is in [context](context.md#the-self); the one-shot reading helpers are in [interns](interns.md).

## Terms

| Term | Meaning |
| --- | --- |
| Person | A root Pi session with a stable session id. `pi --session-id X` can reopen a current person's retained session; `/fork` and `/clone` make a new one. A permanently departed id cannot return. Your own sessions are people too. |
| Organization | Every person whose chain of managers ends at one root. The **root** is a person with no manager. Two roots on one machine are two organizations. |
| Operator | The human. The operator is a person at the top of every organization, listed in the directory as `operator`, with no Pi session. Anyone can mail the operator. |
| Manager | A person whose role has `manages: true`. Managing roles receive organizational insights, peer delegation and manager tools. An unroled recorded organization root shares those capabilities without the management job charter; a nonmanaging role keeps its own posture even at a root. |
| Role | A catalog entry: an obligation, what the role leaves to others, what it delivers, its mind, its tool posture, and whether it manages. Fixed for a person's whole life. |
| Mind | The role's ordered list of models and a thinking level; the first model the session's registry has is used. |
| Soul | Three fragments of the world (random encyclopedia articles) drawn at hire, outside any model, and left unexplained. Never edited. |
| Self | The person's account of itself in four parts (story, practice, commitments, colleagues), rewritten only in reflection. Never distilled, never capped. |
| Record | What the harness knows a person did: assignments and their outcomes, manager history, hire and leave dates. |
| Hire, send home, call in, let go, move | Start a new person with a role and assigned goal; stop a person's process while retaining its membership and context; reopen that dormant person; request irreversible departure after a durable handoff; move a person under another manager. Dormancy preserves context; permanent departure deletes the owned raw session. |
| Thread | One conversation: a subject, its participants, and its messages in order. Mail, team channels, meetings, and task discussions are all threads. |
| Push, pull | How a participant gets a thread's messages. A pushed message arrives as mail (a turn). A pulled message waits until the participant reads the thread. |
| Task | A bundle with a `task.md` goal: a ledger task in a project's `.ledger/`, or an ephemeral task in the state directory. A person works only on tasks assigned to it or taken by it. |
| Interns | `explore` and `research`: cheap, one-shot reading tools that return a lossy summary outside the caller's context. They are not people. |

## The person

**Identity.** The session id is the person. The name comes from the [session-title](context.md#session-titles) extension; a hired person's role title shows beside its name wherever the name shows. A role is set at hire (`hire` with `role`) or by hand (`pi --role <name>`), recorded in the person's own transcript at its first start, and re-applied at every later start; a stored role wins over a later flag. A session started without a role, such as your own, has none, and no soul.

**Mind.** At every start the role's mind is applied: the first model in its list that the registry knows, at the role's thinking level, recorded as the session's `model` fact. A person whose role names no model the registry has starts anyway and warns once. Minds are named by exact model id in the role file, never through a profile, so a role's mind is the same on every machine that has the model.

**Soul.** At its first start, a person with a role draws three random Wikipedia articles (`components/organization/src/soul.ts`) and keeps their titles, descriptions, and lead paragraphs. The soul is rendered under the role, unexplained: the person is told only that these are fragments of the world it came to this work with, that they are not instructions, and that their meaning is its own to find. It is stored with the role, shown as the three titles on the person's card, and never edited. A start whose draw fails (offline) warns and draws at the next start. A soul from before fragments is drawn again.

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

**Record.** The native and pair `directory` share a compact people-discovery contract. With no arguments it returns the organization root, total people and counts by direct manager, role and status. Both text and structured details omit individual histories and souls. Filter by `team` (a manager's direct reports), `subtree` (a person and descendants), exact `role` (`null` for unroled people), `status`, or case-insensitive `name` substring to receive compact matching rows with usable session IDs, manager IDs/names, focus references and held/finished counts. Filters intersect. An explicit `limit` and optional `offset` page people in exact session-ID order; without a limit a deliberate filter returns all its compact matches. Each people result gives `total`, `offset` and `nextOffset` (`null` at the end). A one-person selector accepts a unique exact name, including the caller's, or an ID; duplicate names require IDs.

`person` alone returns a concise current profile, directory, first-start time and held task references. Add `history: {limit: 5, offset: 0}` to request a page of that person's finished assignments and exact outcomes, newest first with assignment-ID ties, with the same totals/continuation fields. Page sizes are chosen by the caller; history has no implicit size. Limits are positive safe integers and offsets are nonnegative safe integers; an offset requires a limit. Person/profile history is separate from people filters and top-level pagination. Finished counts and pages use the same assignment population: unassignments and broad task participation are not accomplishments. These views expose current members, including people at home, rather than former-member discovery. Work/backlog inspection belongs to `org_work`, not this directory. Retained facts are unchanged. Agent World reads the database directly; its cards are independent of these tool payloads.

## The tree

A session started with `--reports-to <id>` has that session as its manager; a session with no manager is a root. The runtime owns the tree: the flag seeds the manager at the first hello and is ignored once the record holds one, a reopen keeps the recorded manager, and `move` is the only way to change it. Prompt identity and mail addressing read the current runtime record, not the launch flag. Prompt changes use Pi's structured sections: the new relationship is appended as a transcript delta, preserving the earlier prefix where the provider supports these transitions. Mail by id reaches any session on the machine, inside or outside the organization; the directory lists only the caller's organization. `/pi-sessions` still lists every live session for you.

Every root session's system prompt carries an `<org>` section: who it is, its id as its mail address, its manager and root, how the directory and mail work, and the norms (work, reports, and escalation follow the tree; a manager is never a relay; say what you verified and what you believe). A hired person is told to ask its manager for people it lacks and when to escalate. A person whose role manages also gets the `<manager>` charter (hire colliding perspectives, give independent thinkers the problem before the preferred answer, delegate whole outcomes, name disagreements, escalate by uncertainty times consequence, investigate recurring fan-in and consider changes to authority, assignments or reporting, reconcile against the directory, sweep). Managing roles and unroled recorded organization roots get the `<role-catalog>` section, one line per role, all management and organizational insight tools, and peer delegation. The packaged managing roles are `coordinator` and `director-of-engineering`; the same `manages` flag governs custom roles. An unroled root keeps its chosen model, thinking and normal Pi coding posture, with concise capability guidance rather than the delegation-first `<manager>` charter. A nonmanaging role stays restricted even at the root; a missing runtime record grants no root exception. Start a new managing session with `pi --role coordinator`; an existing person's stored role remains fixed. The charters are in `components/organization/src/charters.ts`.

## Workplace tools

Every root session has these tools. Each sends a command to the runtime or reads its database; the details are in [session-state](session-state.md#mail-and-threads).

| Tool | What it does |
| --- | --- |
| `directory` (`team?`, `subtree?`, `role?`, `status?`, `name?`, `limit?`, `offset?`, `person?`, `history?`) | Compact organization counts by default; filtered or explicitly paged people, concise current profiles, and caller-requested finished-assignment history pages. Native and pair results share the same compact contract, including structured details. See [Record](#the-person). |
| `send_mail` (`to`, `cc?`, `subject`, `body`) | Starts a mail thread. Addresses are names, session ids, `operator`, `my-team`, and `my-manager`. Every participant is pushed each message. |
| `reply` (`thread`, `body`) | Answers everyone in a thread. In a team channel, the reply stays pulled except for people it names. |
| `inbox` (`all?`) | Lists threads with unread messages, or every thread with `all: true`. |
| `read_thread` (`thread`) | Shows a thread in full and marks it read. |
| `post` (`channel`, `body`, `invite?`) | Posts in a team channel. Posts are pulled; a post that names a participant is pushed to that person. |
| `escalate` (`body`) | Mails the caller's manager with the subject `Escalation`. At a root it goes to the operator. It does not block. |
| `remind_me` (`delay_seconds`, `text` or `command`) | Sends the caller a note, or starts a bash command, after a delay. See [scheduling](scheduling.md). |
| `update_self` (`story?`, `practice?`, `commitments?`, `colleagues?`) | Rewrites the named fields of the person's self. Accepted only in a reflection the harness starts. |
| `take_task`, `focus`, `finish_task`, `promote_task` | The task tools. See [Tasks and assignments](#tasks-and-assignments). |
| `link` (`from`, `to`, `relation`, `reason?`, `data?`, `inferred?`, `confidence?`; or `id`, `resolution?`) | Records or resolves general relationships between tasks, people, files, checks and other results. It is available to every person, independently of organizational inspection. See [session-state](session-state.md#what-it-records). |

Managing roles and unroled organization roots also receive these read-only insight tools:

| Tool | What it does |
| --- | --- |
| `org_expertise` (`area` or `person`, `since?`, `until?`, `subtree?`) | Who knows what, from the read and edit calls people made (counted whether or not they succeeded): for an area (a path, directory, or word in paths), the people who touched it with reads, edits, last touch, the tasks they held then (with the outcome of a finished one), their status, and whether a compaction of their session started since (it may have failed); for a person, the directories it touched. Facts sorted by activity, never a verdict. Paths longer than 120 characters are recorded shortened, so their directories still match but the exact file may not. |
| `org_communication` (`since`, `until?`, and one of `subtree?`, `person?`) | Message counts for person pairs and teams, busiest thread references, and open decisions/explicit escalations awaiting each person. Each group message counts once per other participant in its historical audience; counts do not prove delivery, reading, or waste. Join/leave facts preserve audiences across team moves without retaining access. The result reports when complete tracking began; earlier departed participants cannot be recovered. Historical membership and managers apply at message time. Requests are snapshots at the cutoff. Legacy subject-only escalations are unclassified. |
| `org_work` (`since?`, `until?`, and one of `subtree?`, `person?`, `task?`) | Open work classified once: waiting if a `blocks` or `requires_decision` link from the task is open; otherwise in progress if assigned, or ready if unassigned. Shows hours since opening, holders (assigned people), and people holding several tasks. `until` selects the snapshot time, now by default; `since` also lists tasks opened and closed (`done` or `cancelled`) in that window. Read-only facts with references, not proof of active execution. |
| `org_waits` (`since?`, `until?`, and one of `subtree?`, `person?`, `task?`) | What blocks what: the open `blocks` and `requires_decision` links, grouped by what they wait on with the most waited-on first, each with waiter, reason, age, who recorded it, and whether it crosses teams (neither person manages the other and their managers differ). With `since`, also the waits resolved in that window. Facts with references, never a verdict. |
| `org_fitness` (`since`, `until?`, `subtree?`; or `scenarios`) | Optional economic comparison beside the four inspection tools: realized window or expected scenario outcomes through the same evaluator. Choose exactly one mode. See [Fitness](#fitness). |
| `predictions` (no arguments) | Recorded scenarios targeting the caller's current root exactly: pending or expected/observed fitness with calibration error, or an explicit reason it is unscored. |

## Evidence-informed adaptation

Every person records general relationships, waits and results with `link`. Managing roles and unroled organization roots learn the inspection tools above; other people keep ordinary tool composition with `pi_exec`, without its peer APIs or delegation context. A managing role's charter teaches prudent adaptation during operator requests, planning and implementation, arriving reports or escalations, constrained work and sweeps. Inspect relevant facts, staff from recorded experience and context, investigate causes in tasks, links, history and mail, then use existing management tools when warranted—or deliberately keep a stable organization. Record important reasoning and revisit consequential decisions. Fitness and scenarios are optional instruments when dollar comparisons help, not an objective or a prerequisite for action.

Reporting manager, task owner and decision authority are separate roles that may coincide. Loosely coupled work suits parallel people, tightly coupled work one strong owner, and risky work an independent challenger. Recurring fan-in calls for understanding the constraint before changing authority, assignments or reporting; hiring another manager is an option, not a prescribed response. Staffing uses observed demand and coordination costs rather than a fixed flow threshold. The managing-role charter gate and existing reconciliation/sweep lifecycle remain unchanged.

### Proactive coordination notices

The runtime sends factual mail for three current structural patterns:

- A cycle made entirely of explicit wait links.
- Distinct current work holders converging on a shared dependency that itself has an explicit outgoing wait.
- Repeated back-and-forth in a task's own thread, with at least two returning authors, while an explicit decision wait and downstream dependent waits remain open.

Each notice contains counts and a usable evidence reference, not message bodies, a diagnosis or a staffing recommendation. Discussion participant counts describe potential audiences, not delivery, reading or unnecessary recipients. Ordinary message volume and several requests to a manager are not enough. No inactivity or age threshold is inferred.

Notices reach the closest common eligible manager of the actual waiting, owning or repeatedly contributing people. Passive copied participants do not widen routing. Eligibility is a managing role or an unroled recorded organization root; the operator receives the fallback when no eligible common manager exists. Inspect `org_waits` and the referenced task/thread before choosing a response.

Publication follows committed changes through the existing mail outbox. An unchanged active condition is suppressed across restart; a recorded clear rearms recurrence, and changed responsibility can route a new notice to its new manager. Clears are silent. Publication failure preserves the producing work and retries without claiming that a notice was sent. The observations do not change assignments, reporting or strategy.

## Operator command

In any root Pi session, the human `/org` command remains available regardless of role and shows a compact organization snapshot: open waits grouped by target, ready work without an owner, people holding several tasks, and decisions or explicit escalations pending for each person. It uses the same readers and references as `org_waits`, `org_work` and `org_communication`, at one captured cutoff. Pending requests are cutoff snapshots, so this overview does not replay historical message traffic or read goal files. Counts are recorded facts, not recommendations.

- `/org fitness <since>` renders the same realized dollar breakdown as `org_fitness`, for example `/org fitness 8h` or a start date. Fitness remains optional, with the same coverage and measurement limits.
- `/org expertise <area or person>` renders the same read/edit experience as `org_expertise`. A unique exact organization name (including spaces and the caller's own name) or session ID selects a person; otherwise the full trimmed argument is an area. Duplicate names, including a collision with the caller, require a session ID. `person:<name-or-id>` selects a person explicitly and preserves unknown-person errors. For a filesystem area that collides with a person's name, use `./<path>` or an absolute path.
- Unknown or incomplete forms show these choices. Commands display their results directly; they do not start a model turn or change organization state.

## Manager tools

A person whose role manages, or an unroled organization root, also has ten manager tools:

| Tool | What it does |
| --- | --- |
| `hire` (`role`, `goal`, `title`, `value?`, `cost_of_delay?`, `cwd?`, `name?`, `session_id?`) | Starts a new person in a role, reporting to the caller, with the goal assigned as a task before its first turn. |
| `call_in` (`person`, `goal?`, `value?`, `cost_of_delay?`) | Reopens a person at home with its history. A goal adds an assignment. Refused for a former member. |
| `send_home` (`person`) | Quits the person's process. The person sleeps and stays in the organization. |
| `rename` (`person`, `name`) | Renames a running person. Its id and history stay. |
| `move` (`person`, `manager`) | Puts a person, with everyone under it, under another manager of the same organization. |
| `let_go` (`person`, `reason`) | Accepts an asynchronous permanent departure after explicit responsibility handoff. Saves an own-context handoff file before irreversible removal; later mail reports the outcome. |
| `assign` (`person`, `goal` and `title`, or `task`; `value?`, `cost_of_delay?`) | Gives a person a task or a written goal. It becomes the person's focus. |
| `unassign` (`person`, `task`) | Takes an assignment back without finishing it. |
| `meet` (`people`, `agenda`) | Opens a meeting thread. Every message is pushed to every participant. |
| `end_meeting` (`thread`, `summary`) | Sends the summary and closes the meeting. Only the organizer can end it. |

`person` and `manager` accept a name in the caller's organization or a session id. You can do the same acts from Agent World (hire at a manager's desk, give a goal to a person, let go from a person's actions). The details are in [session-state](session-state.md#manager-tools).

### Permanent departure

Use `send_home` and `call_in` when you want to retain someone's accumulated context. `let_go` is irreversible; a handoff is a summary, not a transcript backup.

1. Finish or reassign every unfinished assignment and move direct reports first. Outstanding owned program resources must finish cleanup. The request also refuses an organization root, self-departure, a duplicate departure, or a program-owned temporary peer (its program owns disposal).
2. Acceptance returns an operation id, not a claim that the person or its resources are gone. The runtime obtains a final Markdown handoff in the person's own session, waking it with its retained context when needed, and saves the document privately under `~/.pi/agent/state/handoffs/`.
3. The runtime rechecks responsibilities before committing permanent departure. It then closes admission and new obligations, proves that known writing processes have stopped, removes checked owned transcript/usage files, and deletes the live person and private session records. Cleanup retries after errors and restart; read the later outcome before treating it as complete.

A handoff or pre-commit failure retains membership and the raw session. After the permanent commit, a cleanup failure leaves removal pending, not a reusable person. Restart does not replay an interrupted paid handoff automatically. The permanent identity fact blocks both explicit restart and ordinary transcript re-admission, including after the live row is gone.

Shared thread messages, finished assignment outcomes, explicit links, audience history and accounting facts survive with name/role/reporting attribution. Private prompt/configuration/self/soul/tool-argument payloads and private command failure text are scrubbed; command chronology and shared-work receipts remain. The minimal departure fact is retained history, not a discoverable live or former directory profile.

This removes known session-owned resources, not independent fork/copy transcripts, project files, browser artifacts, unrelated logs or arbitrary orphan processes outside harness ownership. Existing legacy former records are not silently purged; their historical retirement/rehire intervals remain readable without restoring a rehire tool.

The `<org>` section teaches the push and pull model. A new hire's first turn includes its team channel's history, when the channel has any. The `<manager>` charter suggests a short regular meeting, arranged with `remind_me` and held with `meet`, when the team benefits from one.

## Threads

Every exchange is a thread that the runtime stores. Mail and meetings push every message to every participant. Team channels are pulled: a post waits until the participant reads it, unless the post names that person. Each task has a task thread for its assignees and assigners, also pushed. A pushed message to a person at home waits and arrives when the person wakes. The sender is told who is asleep.

Each manager has a team channel, `team:<manager-id>`, for the manager and its direct reports. Members follow the tree. An invited reader stays when its reporting line changes. Former members leave every channel.

## Tasks and assignments

Work is explicit. Hiring creates and assigns a task before the person's first turn; calling a person in without a new goal preserves its work, while a new goal adds an assignment and becomes its focus. `take_task` takes a written `goal` with a short `title` (creating an ephemeral task whose `task.md` heading is the title) or an existing `task` (its id or ledger path). A goal without a title is refused: the goal is too long to name the task wherever it is listed. Managers use `assign(person, goal and title, or task)` and `unassign(person, task)`. An assignment records who gave whom what, when, and how it ended; assigning a person at home opens its session and starts the work. A wake failure reports that the assignment was saved, so the manager can call the person in without duplicating it.

A person can hold several tasks, with one in focus. `focus(task)` rereads its `task.md`; the file is the goal, not a database copy. The goal is appended to context on assignment or focus, and again after compaction. Editing the file and refocusing brings its revision into context. Each task has a thread shared by its assignees and assigners; taking work also tells the person's manager there.

Ephemeral tasks live under the Pi state directory in `tasks/<id>/`, with `task.md`, `retrospective.md`, and any useful context files. They survive restarts. `finish_task(outcome)` writes the outcome, ends the focused assignment, clears focus, and posts the outcome in the thread. Once all assignees finish, the task is marked done and its entire bundle stays at the original path, including its retrospective and artifacts. Finishing does not move or delete the directory. Previously archived bundles stay at their recorded history paths. Ledger tasks keep the ledger's separate status and archive workflow.

Only an unroled organization root or a managing role can `assign` and `unassign`, and only inside its own organization. The operator can assign anyone. `take_task` with an existing task works only when nobody else holds that task.

`promote_task(task)` moves a live ephemeral bundle into its project's `.ledger/`, through the same index transaction as `ledger_add`. Files, assignment identity, and thread stay together. Its heading supplies the ledger title and summary; optional `title` and `description` can name it more clearly. The runtime alone writes assignments and focus. Editing a ledger bundle never assigns work; use `link` for explicit task and artifact relationships. Archiving a registered ledger task updates its bundle path without ending assignments or changing their identity. Views read the explicit focus, never old inferred intent or ledger touches.

## Fitness

`org_fitness` is an optional analytical instrument beside `org_waits`, `org_work`, `org_communication` and `org_expertise`. Use it when an economic comparison helps; management decisions can also use direct evidence, context, uncertainty and judgment. It is not a compulsory objective or a prerequisite for organizational actions. Realized fitness over a window is value earned minus delay accrued minus compute plus incurred impacts, computed each time from recorded facts and the current `task.md` files; nothing is stored.

- **Value** is earned once, when a task completes (an ephemeral task closed after its last assignee finishes, a ledger task closed `done`). A cancelled task earns nothing.
- **Delay** is the task's cost of delay per hour while it is the organization's obligation: from when the runtime recorded it until it closes. Unfinished valuable work keeps costing, so an idle organization with valuable outstanding work scores negative.
- **Compute** is each member's model spend at the time it happened, counted only while the person was a member: from its join (a former root that takes a manager joins then), until departure. Existing legacy retirement/rehire intervals remain historical evidence; new permanent departures do not reopen. Spend a session already had before the runtime recorded any cost for it is a baseline, not new spend. Spend is placed at the time the runtime observed it: spend made while the runtime was down lands in the window of the reconnect. A temporary `pi_exec` peer's spend follows immutable creation ancestry recursively to its first lasting caller, counted exactly once under that caller's membership at observation time. Reporting moves do not change this beneficiary. New peer identities record a zero cost baseline atomically with launch ownership before any process/hello, so their first positive hello counts as spend; ordinary and legacy identities keep the first-sight transcript baseline convention. Durable identity/caller facts survive cleanup. Migration preserves known surviving legacy caller mappings as observations, not invented births or zero baselines; discarded peers with unknown callers/ancestry and already-deleted assignment spans remain explicit limits. The first retained identity fact wins, including unknown identity recorded at disposal: a later observed/live caller cannot bind that prior lifetime. This conservatively includes old pending cleanup when its surviving facts cannot distinguish it from pre-upgrade ID reuse. An unknown temporary identity starts with unknown structural ancestry, not its reused current snapshot or a first transfer's backward `from` premise; actual recorded `to` changes still govern ancestry at their event times. Known-created and unambiguous legacy histories retain their existing replay conventions.
- Program-internal ephemeral tasks held only by temporary peers stay excluded even across sequential disposal; work with lasting assignment history or ledger status survives. Cleanup ends still-open retained assignments with a non-finished reason, preserving earlier ends/outcomes and past in-progress delay. Existing retained work-change/task-post and operator-thread history survives without a second store. Disposal reparenting records the same historical transfer used by ordinary moves. Temporary IDs remain temporary after cleanup and cannot be reopened as new lasting people or new peers. Admission enforces this both when starting work and when a bridge says hello: reopening a retained transcript keeps its UUID even without the old program environment, so an ordinary hello cannot recreate that discarded person. Valid live program hello/reconnect and ordinary new identities retain their normal behavior.
- **Delay by state** splits each task's delay into queued (nobody holds it and nothing blocks it: it needs people), waiting (an open `blocks` or `requires_decision` link: it needs a decision or another task), and in progress. Open waits are listed with their age. Several waits on one task never charge its delay twice.
- **Interruptions** count the questions members opened to the operator and the messages members sent in mail threads the operator is in. Temporary-peer questions and operator mail/escalations follow the same first-lasting-caller membership convention as compute, including after disposal. The operator's time is priced at $1 per minute in the model, but nothing measures it yet, so it is shown as unmeasured and left out of the number; time spent waiting for the operator already shows as delay.
- **Impacts** are recorded assertions, not verified facts. Any link can carry `data: {"impact": {"dollars": -120, "kind": "incurred", "at": 1793000000000}}`; `at` is optional epoch milliseconds, defaulting to link creation. Negative dollars record a loss, positive dollars a gain. A backdated impact restates its declared past window even if its link was created later: this reads current assertions, not only what was known at that time. Only `incurred` impacts enter the total; `estimated` impacts are listed without charge. Each entry retains its link, endpoints and recorder. Record what happened, never an avoided loss (that belongs in a scenario), and never repeat value or cost already counted. `fixes` and `supersedes` alone change nothing; a fix task earns its own value under the same no-double-counting rule as any task.
- **Spend on dropped work** explains compute and delay already counted on tasks now recorded as cancelled or as the target of a `supersedes` link (replacement points to replaced work). This is a current-outcome annotation of historical spend: cancellation or replacement may have been recorded after the selected window. It never charges again or declares that dropping the work was wasteful. Delay comes from evaluated task contributions. Task compute is an estimate from the accounting person's focus at the runtime's compute observation time, not exact inference time or a division among all assignments. For temporary-peer spend, that is the lasting caller's focus, not a separate task the actual emitter focused on; caller attribution does not create emitter-level task allocation. Known focus on eligible, historically owned non-dropped work stays attributed, not unattributed. Compute with no known focused eligible owned task is listed as unattributed and is never guessed to be dropped.
- Focus history uses retained successful work changes joined to their atomic task-thread posts, including transitions before the window. `take`, `assign` and `focus` set it, `finish` clears it, and `unassign` clears only a matching focused task; promotion leaves it unchanged. A focus without a retained work-change/post pair is unknown, rather than inferred from today's focus. Equal-time transitions follow task-post sequence; every transition at the compute observation timestamp counts before that compute for this estimate. There is no common causal sequence between posts and compute events. Subtree evidence follows the existing held-task/person contribution scope; the root total is unchanged.
- **Findings** are `finds` links targeting a task. Its owner resolves them `accepted` or `rejected` by convention, not enforced ownership. Fitness lists findings created in the requested activity window, grouped by target task and recorder, with their resolution as of the cutoff (a resolution exactly at the cutoff counts). This is not a list of all historical findings or resolutions made during the window. Findings are evidence, never value or reviewer credit.
- Impacts follow the link's originating organization's structural ancestry at the impact time; findings use link creation time. Legacy links without an origin use task endpoint ownership or recorder membership. Today's reporting tree does not rewrite earlier ownership. Subtree selection filters displayed evidence and contributions, never the organization's total.
- Any split of a window adds up to the whole, because every part is charged at the time it happens.
- A task without a readable value counts nothing and is reported as unvalued, which marks the number incomplete; the share of value that rests on agents' estimates is shown too. Editing a value restates past windows: fitness reflects the best current understanding of value.
- There is no score per person or team; narrowing to a subtree only filters the contributions that explain the whole.

The value and cost of delay come from the task's `task.md` header (`Value: $50 (estimated by Name)`, `Cost of delay: $5/hour`); see [session-state](session-state.md#tasks-and-assignments). The design and the rest of the plan are in the ledger task `.ledger/202610242320-org-mri-morphogenesis/` (`spec.md`). Fitness is only as trustworthy as the values people give their work.

### Scenarios and predictions

Scenarios are an optional forecast, not a prerequisite for changing an organization. Call `org_fitness` with `scenarios` instead of window arguments (`since`, `until`, `subtree`). The adapter emits the same economic events as history and uses the same pure evaluator U; expected fitness is the probability-weighted sum of outcome U values. The manager supplies forecasts and the starting premise. The tool neither optimizes organizations nor certifies that the premise matches live work.

```json
{
  "name": "One builder",
  "decisionAt": "recording",
  "horizonMs": 7200000,
  "organization": "One builder, no reviewer",
  "opportunities": [
    { "id": "change", "taskId": "work-existing-id", "value": 300, "costOfDelayPerHour": 0 }
  ],
  "start": [],
  "outcomes": [
    {
      "probability": 1,
      "tasks": [{ "opportunity": "change", "openedMs": 0, "closedMs": 3600000, "status": "done" }],
      "compute": [{ "atMs": 0, "dollars": 10 }],
      "impacts": []
    }
  ],
  "evidence": ["link:optional-evidence"]
}
```

- `decisionAt` is an absolute epoch-millisecond origin or `"recording"`. All history/event times are millisecond offsets from that origin; `horizonMs` is positive and must produce a finite end strictly after its bound origin in JavaScript's numeric representation, both in preview and at recording. A positive offset that rounds back to the origin is refused; there is no fixed minimum horizon. A preview resolves every relative origin against one captured now. Recording later binds independently to the immutable link creation time; the preview is not a promise of that later timestamp.
- Opportunities declare unique IDs, optional unique exact runtime task identities, and nonnegative value and hourly delay. Anticipated work can omit `taskId`. Each history pairs `closedMs` with `status` (`done` or `cancelled`), closing no earlier than opening. Start rows open and close at or before zero. Every outcome contains a complete history of every initial obligation, preserving opening and any already-closed state; initial open work can close at or after zero. Other opportunities may be pursued at or after zero or left unselected.
- Outcomes are nonempty, with finite probabilities in `[0,1]` summing to 1 (machine-roundoff allowance only, without renormalization). All numbers are finite; compute is nonnegative and impacts are signed. U keeps its half-open window: a close at zero earns value once, a negative close is outside, and a close at the horizon earns no value in that window. Delay is clipped by overlap. The adapter invents no assignment/wait state and omits the unavailable delay-state breakdown from outcome totals and contributions.
- Comparison requires the same resolved decision point, horizon, opportunity IDs/task identities, numeric valuations and initial histories. Array ordering does not matter; IDs use exact string identity/order rather than locale collation. Assumed organization text, outcomes, names and evidence may differ. A difference is named rather than silently comparing unlike premises.

To record a prediction, use `link` from the message stating the proposed change to `organization:<root-id>` with `relation: "predicts"` and `data: {"scenario": <the scenario>}`. Record before acting. The generic link stores the data unchanged; there is no separate binding store. Keep hypothetical impacts inside the scenario, separate from top-level incurred `data.impact` assertions.

`predictions` reads links targeting the current root identity exactly, with existing historical-origin admission. It does not aggregate a former root's forecasts after a merge. Each forecast observes its retained target identity over `[link.created_at, link.created_at + horizonMs)`, never a substituted larger current root. Before the horizon ends it is pending and computes no future observed fitness; at the exact endpoint it can show expected and observed totals and forecast error (observed minus expected). That error measures calibration, not the causal effect of a mutation. Observations retain coverage, incompleteness, known exclusions and the unmeasured attention term. An incomplete observed valuation suppresses numerical error as `observed fitness incomplete`, while preserving the measured total; static exclusions alone do not make every forecast unscorable. Nonfinite actual totals are explicitly unavailable (`observed: null`), and nonfinite derived calibration is unscored, each with a reason. Nonrepresentable coverage shares are separately marked unavailable with a metadata reason; counts and finite shares remain unchanged, and that metadata limitation alone does not suppress a finite calibration.

An absolute scenario origin unequal to recording time remains a clock mismatch; its raw clock is not shifted, and expected plus available observed totals stay visible without numerical error. Current numeric value or delay changes on any opportunity suppress error as `valuation changed`; unmapped, missing, unvalued, not-yet-opened or foreign-at-recording task identities suppress it as `valuation unverifiable`. Every opportunity is checked, including unpursued work. Goal files are read only after historical ownership and retained opening-time checks (`opened_at` present and at or before recording). A later-created task never backfills an earlier forecast's valuation basis; unknown opening time is unverifiable. Equal-timestamp openings count, without claiming cross-domain causal sequence. Unrelated files are not dependencies, and genuine I/O failures on relevant owned files remain errors. Task identity survives moves/archives, and formatting or estimate authorship alone is not numeric drift. Unreadable scenario payloads and non-message prediction sources retain raw data and reason per row, without restricting generic link writes. This isolation covers generic-link payloads, not corrupted SQLite or arbitrary realized-history failures.

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
- `send_home` retains the person's id, transcript, self and membership. A successful `let_go` permanently removes its live identity and owned raw session after a durable own-context handoff, while retaining shared organizational evidence. A `pi_exec` temporary peer remains its program's disposal responsibility ([exec](exec.md#peers-and-schemas)).
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
| The terminal views | [tmux-sessions](tmux-sessions.md): organizations as indented trees with role titles and retained legacy former rows |
| The picture | [agent-world](agent-world.md): headquarters per root, a team room per manager, cards, the hire form, retiring, former members at the inn |
| Interns | [interns](interns.md): `explore` and `research`, fixed prompts and the `quick` profile |

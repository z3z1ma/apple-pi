# The organization

A Pi session is not a throwaway process. It is a **person**: a stable id, a human name, a role it cannot shake, a mind, a soul, a self, a record, a mailbox, and a place in an **organization**. The organization is a tree rooted at the session you start; managers hire from a **role catalog**, build teams of colliding perspectives, and bring in managers under them when their own attention would become the bottleneck. Everyone can read the whole directory and mail anyone in the organization; the tree carries only assignment, reporting, and escalation. Nobody is deleted: closing is sleep, retiring is leaving. The terminal is the organization; the [tmux sidebar](tmux-sessions.md) and [Agent World](agent-world.md) are its pictures.

This page is the product contract. The runtime mechanics (the database, the commands, the facts) are in [session-state](session-state.md); the self's place among the session's memories is in [context](context.md#the-self); the senses that are not people are in [subagents](subagents.md).

## Terms

| Term | Meaning |
| --- | --- |
| Person | A root Pi session with a stable session id. `pi --session-id X` reopens the same person; `/fork` and `/clone` make a new one. Your own sessions are people too. |
| Organization | Every person whose chain of managers ends at one root. The **root** is a person with no manager. Two roots on one machine are two organizations. |
| Manager | A person whose role manages, or the root of an organization. Only managers hire, reopen, close, rename, transfer, and retire people. |
| Role | A catalog entry: an obligation, what the role leaves to others, what it delivers, its mind, its tool posture, and whether it manages. Fixed for a person's whole life. |
| Mind | The role's ordered list of models and a thinking level; the first model the session's registry has is used. |
| Soul | A temperament the harness draws at hire from local lists, like a name. Never edited. |
| Self | One Markdown document the person keeps about itself and its teammates, written with `update_self`. Never distilled, never capped. |
| Record | What the harness knows a person did: directory, ledger tasks, stated intent, manager history, hire and retire dates. |
| Hire, transfer, close, reopen, retire | Start a new person with a role under a manager; move a person under another manager; stop the process (the person sleeps); start it again with its history; record that the person has left (it stays reopenable). |
| Senses | The two subagents every session keeps, `explorer` and `researcher`, to spend less of its own context. They are not people. |

## The person

**Identity.** The session id is the person. The name comes from the [session-title](context.md#session-titles) extension; a hired person's role title shows beside its name wherever the name shows. A role is set at hire (`hire` with `role`) or by hand (`pi --role <name>`), recorded in the person's own transcript at its first start, and re-applied at every later start; a stored role wins over a later flag. A session started without a role, such as your own, has none, and no soul.

**Mind.** At every start the role's mind is applied: the first model in its list that the registry knows, at the role's thinking level, recorded as the session's `model` fact. A person whose role names no model the registry has starts anyway and warns once. Minds are named by exact model id in the role file, never through a profile, so a role's mind is the same on every machine that has the model.

**Soul.** Drawn at hire with no model call (`components/organization/src/soul.ts`): a stance (contrarian, consensus-seeking, independent), an evidence taste (first principles, measurement, precedent), a risk appetite, a length, an outlook on estimates, and one habit from a long list. It is rendered as one paragraph under the role in the system prompt, stored with the role, and shown as one line in the directory and on the person's card. Two people in one role differ by soul. The person cannot edit it.

**Self.** One Markdown document per person, replaced whole with `update_self` and shown as the `<self>` section at every run; a person that has never written one sees suggested headings (the people it works with and what it thinks of them, who has done what, standing agreements, what it is on, what it has learned about this organization). It lives in the person's transcript and is reported to the runtime as the `self` fact, so the views show its headings. The [notebook](context.md) keeps its own job, sourced learnings about the work; the self is the person's own account of itself and its colleagues.

**Record.** The directory (`directory`) shows every member of the caller's organization with its id, name, role and title, manager, status, directory, current ledger task, the ledger tasks it has worked on, when it first started, and, on request (`former: true`), when and why a former member left. Every manager change is kept (`manager_changes`). The record is public to the organization; Agent World's card is built from it.

## The tree

A session started with `--reports-to <id>` has that session as its manager; a session with no manager is a root. The runtime owns the tree: the flag seeds the manager at the first hello and is ignored once the record holds one, a reopen keeps the recorded manager, and `move` is the only way to change it. Mail by id reaches any session on the machine, inside or outside the organization; the directory lists only the caller's organization. `/pi-sessions` still lists every live session for you.

Every root session's system prompt carries an `<org>` section: who it is, its id as its mail address, its manager and root, how the directory and mail work, and the norms (work, reports, and escalation follow the tree; a manager is never a relay; say what you verified and what you believe). A hired person is told to ask its manager for people it lacks and when to escalate. A manager also gets the `<manager>` charter (hire colliding perspectives, give independent thinkers the problem before the preferred answer, delegate whole outcomes, name disagreements, escalate by uncertainty times consequence, hire a manager under itself when fan-in would make it the bottleneck, reconcile against the directory, sweep) and the `<role-catalog>` section, one line per role. The charters are in `components/organization/src/charters.ts`.

## Manager tools

A root, and a person whose role manages, holds six tools besides the directory: `hire` (`role`, `cwd`, optional `name`, `prompt`, `session_id`), `rehire`, `send_home`, `rename`, `move` (a person with everyone under it, to another manager of the same organization), and `let_go` (`reason`). The same acts are available to you from Agent World (hire at a manager's desk, retire from a person's actions) and the retire and transfer commands of the runtime. The details are in [session-state](session-state.md#manager-tools).

## Tasks and assignments

Work is explicit. `take_task` takes a written `goal` (creating an ephemeral task) or an existing `task` (its id or ledger path). Managers use `assign(person, goal or task)` and `unassign(person, task)`. An assignment records who gave whom what, when, and how it ended; assigning an asleep person opens its session and starts the work. A wake failure reports that the assignment was saved, so the manager can rehire without duplicating it.

A person can hold several tasks, with one in focus. `focus(task)` rereads its `task.md`; the file is the goal, not a database copy. The goal is appended to context on assignment or focus, and again after compaction. Editing the file and refocusing brings its revision into context. Each task has a thread shared by its assignees and assigners; taking work also tells the person's manager there.

Ephemeral tasks live under the Pi state directory in `tasks/<id>/`, with `task.md`, `retrospective.md`, and any useful context files. They survive restarts. `finish_task(outcome)` writes the outcome, ends the focused assignment, clears focus, and posts the outcome in the thread. Once all assignees finish, an ephemeral bundle moves to `tasks/history/<id>/`, including its retrospective. Ledger tasks keep the ledger's separate status and archive workflow.

`promote_task(task)` moves a live ephemeral bundle into its project's `.ledger/`, through the same index transaction as `ledger_add`. Files, assignment identity, and thread stay together. Its heading supplies the ledger title and summary; optional `title` and `description` can name it more clearly. The runtime alone writes assignments and focus.

## The role catalog

A role is a Markdown file: front matter (`title`, `mandate`, `models`, `thinking`, `writes`, `manages`) and a body that is the role's obligation, what it is not responsible for, how it works, and what it delivers, ending with the one standing rule: say what you verified and what you believe. The catalog is the package's `roles/` directory, then `~/.pi/agent/roles/`, then `<cwd>/.pi/roles/`, a later file replacing an earlier one of the same name. A malformed file is reported by path and skipped. Managers see the whole catalog in their prompt and hire by name.

The package ships thirty-one roles. `advises` means the role has no `edit` or `write` tool: it reads, runs, and reports, and someone who writes carries its findings into code.

| Role | Title | Mandate | Mind, in order | Thinking | Posture |
| --- | --- | --- | --- | --- | --- |
| `accessibility-specialist` | Accessibility Specialist | Find keyboard, screen reader, semantic, inclusive failures | `anthropic/claude-sonnet-5-5`, `openai/gpt-6.1-sol` | medium | advises |
| `architecture-prosecutor` | Architecture Prosecutor | Build the strongest evidence that the design is wrong | `anthropic/claude-opus-5-5`, `openai/gpt-6-astra` | high | advises |
| `chaos-engineering-specialist` | Chaos Engineering Specialist | Design failure injection, partial outage, retry, degradation | `anthropic/claude-sonnet-5-5`, `openai/gpt-6.1-sol` | medium | advises |
| `chief-architect` | Chief Architect | Judge boundaries, invariants, evolution, coherence | `anthropic/claude-opus-5-5`, `openai/gpt-6-astra` | high | advises |
| `code-review-specialist` | Code Review Specialist | Find real defects, regressions, maintainability problems in diffs | `anthropic/claude-sonnet-5-5`, `openai/gpt-6.1-sol` | medium | advises |
| `coordinator` | Coordinator | Chief of staff for the operator; runs the org, keeps threads, sweeps | `openai/gpt-6.1-sol`, `anthropic/claude-opus-5-5` | high | manages, writes |
| `database-reliability-architect` | Database Reliability Architect | Attack migrations, locking, isolation, corruption, rollback | `anthropic/claude-opus-5-5`, `openai/gpt-6.1-sol` | high | advises |
| `developer-experience-lead` | Developer Experience Lead | Judge APIs, naming, errors, docs, integration friction | `anthropic/claude-sonnet-5-5`, `openai/gpt-6.1-sol` | medium | advises |
| `director-of-engineering` | Director of Engineering | Route work, set decision gates, resolve conflicts, own delivery | `openai/gpt-6.1-sol`, `anthropic/claude-opus-5-5` | high | manages, writes |
| `distinguished-member-of-technical-staff` | Distinguished Member of Technical Staff | Widen the solution space before the org commits | `anthropic/claude-fable-5-1`, `anthropic/claude-opus-5-5`, `openai/gpt-6-astra` | high | advises |
| `distributed-systems-researcher` | Distributed Systems Researcher | Attack consistency, concurrency, fault, and recovery assumptions | `anthropic/claude-fable-5-1`, `openai/gpt-6-astra` | high | advises |
| `end-user-customer-advocate` | End-User Customer Advocate | Protect the user from engineering convenience | `openai/gpt-6-astra`, `anthropic/claude-opus-5-5` | high | advises |
| `implementation-engineer` | Implementation Engineer | Make bounded, tested changes with no extra scope | `anthropic/claude-sonnet-5-5`, `openai/gpt-6-luna` | medium | writes |
| `infrastructure-cfo` | Infrastructure CFO | Price decisions in spend, hours, lock-in, maintenance | `openai/gpt-6.1-sol`, `anthropic/claude-sonnet-5-5` | medium | advises |
| `maintainer-from-three-years-ahead` | Maintainer From Three Years Ahead | Judge comprehensibility, upgrade cost, operational burden | `anthropic/claude-sonnet-5-5`, `openai/gpt-6.1-sol` | medium | advises |
| `paradigm-outsider` | Paradigm Outsider | Solve it without the current stack or conventions | `anthropic/claude-fable-5-1`, `openai/gpt-6-astra` | high | advises |
| `performance-engineering-lead` | Performance Engineering Lead | Find complexity, tail latency, contention, limits | `openai/gpt-6.1-sol`, `anthropic/claude-opus-5-5` | medium | advises |
| `principal-engineer` | Principal Engineer | Turn a design into a plan grounded in the repository | `anthropic/claude-sonnet-5-5`, `openai/gpt-6.1-sol` | medium | advises |
| `principal-site-reliability-engineer` | Principal Site Reliability Engineer | Ask what fails at 3 a.m. and how it recovers | `openai/gpt-6.1-sol`, `anthropic/claude-sonnet-5-5` | medium | advises |
| `principal-ux-researcher` | Principal UX Researcher | Form usability, mental-model, and discoverability hypotheses | `anthropic/claude-opus-5-5`, `openai/gpt-6-astra` | medium | advises |
| `quality-engineering-director` | Quality Engineering Director | Find missing test dimensions; turn risk into checks | `anthropic/claude-sonnet-5-5`, `openai/gpt-6.1-sol` | medium | advises |
| `release-engineering-lead` | Release Engineering Lead | Plan rollouts, rollback, flags, compatibility | `anthropic/claude-sonnet-5-5`, `openai/gpt-6.1-sol` | medium | writes |
| `repository-archaeologist` | Repository Archaeologist | Dig out hidden assumptions, prior art, conventions | `anthropic/claude-haiku-5-5`, `openai/gpt-6-luna` | low | advises |
| `scientific-skeptic` | Scientific Skeptic | Separate fact from assumption; design the cheapest falsifying test | `openai/gpt-6-astra`, `anthropic/claude-fable-5-1` | high | advises |
| `skeptical-first-time-user` | Skeptical First-Time User | Use the product with no knowledge of its internals | `anthropic/claude-haiku-5-5`, `openai/gpt-6-luna` | low | advises |
| `staff-engineer-simplicity` | Staff Engineer, Simplicity | Remove accidental complexity without losing correctness | `openai/gpt-6.1-sol`, `anthropic/claude-sonnet-5-5` | medium | advises |
| `staff-security-engineer` | Staff Security Engineer | Threat-model trust boundaries, authorization, exposure, abuse | `anthropic/claude-opus-5-5`, `openai/gpt-6-astra` | high | advises |
| `technical-due-diligence-partner` | Technical Due Diligence Partner | Find hidden dependencies, migration traps, irreversible commitments | `anthropic/claude-opus-5-5`, `openai/gpt-6-astra` | high | advises |
| `technical-writer` | Technical Writer | Keep decision records, references, handoffs, runbooks | `anthropic/claude-haiku-5-5`, `openai/gpt-6-luna` | low | writes |
| `test-and-ci-operator` | Test and CI Operator | Run checks and report failures exactly | `anthropic/claude-haiku-5-5`, `openai/gpt-6-luna` | low | advises |
| `vp-of-product` | VP of Product | Ask whether this is the right thing to build | `openai/gpt-6-astra`, `anthropic/claude-opus-5-5` | high | advises |

The two managing roles differ in principal: a `coordinator` is your chief of staff, started once in its own directory with its own id (`pi --role coordinator --session-id coordinator` in `~/coordinator`) and kept for good; a `director-of-engineering` is hired under a root or another manager to run a team. Both hire from the same catalog.

## Rules of the organization

- Roles never change. A person who needs another role is a new hire; the old one sleeps or retires.
- Nobody is deleted. `close` is sleep (the person keeps its id, transcript, self, and record); `retire` records when and why it left and keeps it reopenable by a manager.
- The tree carries assignment, reporting, and escalation; it does not gate mail. A manager that only forwards mail is a relay, which the charter forbids.
- There is no handoff schema. People give each other goals and say what they verified and what they believe.
- There are no caps: not on team size, self length, or the catalog. Managers size teams with judgment, and the charter names the one signal to watch (fan-in).

## Where it lives

| Piece | Owner |
| --- | --- |
| Roles, minds, souls, the self tool, the charters, and the directory | `components/organization/` (`roles.ts`, `soul.ts`, `self.ts`, `charters.ts`, `directory.ts`, `install.ts`), installed by `extensions/session-state.ts` in every root session |
| The manager tools and the directory tool | `components/session-state/src/coordinator.ts` and `peers.ts` |
| The package catalog | `roles/*.md` |
| The tree, the record, and the facts (`role`, `title`, `manages`, `soul`, `self`, `retired_at`, `retired_reason`) | the session-state runtime and database, [session-state](session-state.md) |
| The terminal views | [tmux-sessions](tmux-sessions.md): organizations as indented trees with role titles and folded former members |
| The picture | [agent-world](agent-world.md): headquarters per root, a team room per manager, cards, the hire form, retiring, former members at the inn |
| The senses | [subagents](subagents.md): `explorer` and `researcher`; `builder` stays unlisted for programs |

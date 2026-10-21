# Organization: specification

Written 2026-10-20 from the conversation that shaped this task. It builds on the session-state runtime (`docs/session-state.md`), the coordinator (`components/session-state/src/coordinator.ts`, `coordinator-prompt.ts`), session titles (`docs/context.md#session-titles`), and Agent World (`docs/agent-world.md`). The seed idea came from a Hacker News thread on role-played engineering organizations; what we take from it is the roster of roles with conflicting obligations, each on a named model, and the rule that independent context beats a shared one. Its tooling, cost tables, and handoff schema do not come along.

## Problem

A peer session today is a worker: a UUID with a drawn name, started with a brief, reporting to one coordinator. The coordinator is the only manager, the only one who can hire, and the relay for everything. All workers are the same kind of mind with the same prompt, so a team of four finds what one would find. Nothing in the harness keeps a session's view of its teammates; the coordinator keeps a roster file by hand. The subagent team mixes senses (explorer, researcher) with roles that should be colleagues (builder, planner, designer, consultant). Agent World draws a star around one coordinator because that is all there is.

## Solution

A Pi session becomes a **person**: a stable id, a human name, a role it cannot shake, a mind (its model), a soul (its temperament), a self (its own memory), a record (what it has done), a mailbox, and a place in an **organization**. The organization is a tree rooted at the session the operator starts. Managers are people whose role manages; they hire from a **role catalog**, build balanced teams, and bring in managers under them when their own attention would become the bottleneck. Everyone can read the whole directory and mail anyone in the org; the tree carries only assignment, reporting, and escalation. Nobody is deleted: closing is sleep, retiring is leaving. The terminal is the organization; Agent World is its picture.

Roles name their minds exactly: an ordered list of models and a thinking level. The catalog is wide from the start and ships in the package.

## Terms

- **Person**: a root Pi session with a stable session id. The operator's own sessions are people too.
- **Organization (org)**: every person whose chain of managers ends at one root. The **root** is a person with no manager. Two root sessions on one machine are two orgs.
- **Manager**: a person whose role manages, or the root of an org. Only managers hire, transfer, retire, close, and reopen people.
- **Role**: a catalog entry: an obligation, what the role leaves to others, the artifact it owes, its mind, its tool posture, and whether it manages. Fixed for a person's whole life.
- **Mind**: the role's ordered list of models and a thinking level; the first model the session's registry has is used.
- **Soul**: a temperament the harness draws at hire from local lists, never edited.
- **Self**: one Markdown document the person keeps about itself and its teammates through a tool, stored by the harness and shown to the person at every start and after every compaction.
- **Record**: what the harness knows a person did: directory, ledger tasks, stated intent, manager history, hire and retire dates.
- **Hire**: start a new person with a role under a manager. **Transfer**: move a person under another manager. **Close**: stop the process; the person sleeps. **Reopen**: start the process again with its history. **Retire**: record that the person has left; it stays reopenable.
- **Senses**: the two subagents every session keeps, explorer and researcher. They are not people.

## The person

### Identity

- The session id is the person. `pi --session-id X` reopens the same person; `/fork` and `/clone` create a new one (as today).
- The name comes from the session-title extension (exists). A hired person also gets its role's title shown beside the name wherever the name shows.
- The role is set at hire, stored with the person, and re-applied at every start. A session started by hand with `--role` takes the role at its first start; a stored role wins over a later flag.

### Mind

At every start the role's mind is applied: the first model in the list that the registry knows, at the role's thinking level. The applied model is recorded as the session's `model` fact (exists). A person whose role names no model the registry has starts anyway and warns once.

### Soul

Drawn at hire, with no model call, from local lists in the package, like names. The draw gives a few lines of temperament that shape how the person argues, not what its role obliges it to:

- stance: contrarian, consensus-seeking, or independent;
- evidence taste: first principles, measurement, or precedent;
- risk appetite: bold or cautious;
- length: terse or thorough;
- outlook on estimates: optimistic or wary;
- one habit from a long list (for example "asks what would change its mind before arguing", "wants the small experiment first", "writes the summary before the detail").

The soul is rendered as a short paragraph in the person's system prompt, under its role. Two people with the same role and mind differ by soul. The operator's own sessions have no soul and no role; a session hired with a role always has one.

### Self

One Markdown document per person, kept by the session-state runtime, keyed by the person's id. The person writes it with one tool, `update_self`, which replaces the document. The harness seeds a new person's self with suggested headings (the people I work with and what I think of them, who has done what, standing agreements, what I am working on now, what I have learned about this org); the person keeps what it wants and no shape is enforced. There is no size cap. The self is injected as a system prompt section at every start and re-injected after each compaction, so it survives sleep, restarts, and compaction. The notebook (`docs/context.md`) keeps its job: learnings about the work, distilled into project files. The self is never distilled and never read by the pair programmer's distillation.

### Record

The database already holds each person's directory, model, ledger tasks (`session_tasks`), current task, intent, and manager. This task adds the role, the soul, the hire date, the retire date and reason, and manager changes. The record is public to the org: the directory shows it, and Agent World's profile card is built from it.

### Lifecycle

- **Hire** (`start_peer_session` with a `role`): a manager starts a person in a directory, with a brief as the first prompt. The runtime draws the soul, stores the role, and starts `pi --session-id <id> --name <name> --role <role> --reports-to <manager>`. The new person's window opens next to the manager's pane.
- **Sleep and wake**: `close_peer_session` and `reopen_peer_session` (exist). Reopen re-applies role, mind, soul, and self.
- **Transfer** (`transfer_peer_session`): a manager moves a person (or a whole manager with its team) under another manager in the same org. The runtime refuses a cycle. All three parties are told by mail; the moved person's close notices go to its new manager from then on.
- **Retire** (`retire_peer_session`): records the leaving date and reason. The person is closed if running, shown under former members in the directory, and still reopenable; reopening by a manager clears the retirement.
- Nothing deletes a person.

## The organization

### Root and tree

- The org is bound to the root session id. The session the operator starts by hand is a root; everything hired under it at any depth is its org. `pi --session-id X` reopens X with the org that grew around it.
- A root session has the manager tools active even without a managing role: it is the operator's seat. A session started with `--role coordinator` and no manager is also a root, so the old `pi --coordinator` pattern continues as `pi --role coordinator`.
- The relation is `reports_to` (exists) and becomes mutable through transfer.

### Managers

- A manager hires from the catalog, gives whole outcomes, engages when a person reports, asks, is blocked, or misses its definition of done, and sizes the team like hiring (the existing charter's hiring, retiring, sweeping, and reconciliation rules stay).
- When a manager judges that its own fan-in of reports, questions, and escalations would make it the bottleneck, it hires a manager role under itself and transfers people to it. This is judgment in the charter; there is no number.
- A non-manager who needs a person asks its manager by mail. Only managers hire.
- The manager's roster file goes away: the directory is the database, and the manager's opinions of its people live in its self.

### Communication

- **Directory**: `list_peer_sessions` shows every person in the caller's org: id, name, role, manager, status, directory, current task, one line of soul, and record summary; retired people are listed as former members. Sessions in other orgs are not shown. Mail by id still reaches any session on the machine (exists), so a person who knows an id outside its org can write to it.
- **Mail** is open across the org. Anyone can write to anyone.
- **Tree traffic**: a person takes work from its manager, reports to its manager, and escalates up. A cross-team exchange that changes a decision or someone's load is copied to the managers involved. These are goals in the charters, not enforced routes.
- **No handoff schema.** A manager gives a goal and context; a person decides what to send back. Every charter carries one standing goal: say what you verified and what you believe.
- **Independent context** is a tool managers use on purpose: hire the person who must think independently before the preferred answer exists, give it the problem and the constraints, and withhold the leading proposal. Temporary hires are the natural fit for roles that need to know less (the first-time user, the outsider).

## Roles

### Definition

A role is a Markdown file with front matter, discovered like custom agents: the package's `roles/` directory first, then `~/.pi/agent/roles/`, then `<cwd>/.pi/roles/`, later directories overriding earlier ones by name.

```markdown
---
title: Distinguished Member of Technical Staff
models: [anthropic/claude-fable-5-1, anthropic/claude-opus-5-5, openai/gpt-6-astra]
thinking: high
writes: false
manages: false
---
You are a Distinguished Member of Technical Staff ...
```

- `title`: shown beside the name.
- `models`: ordered preference; `thinking`: Pi thinking level.
- `writes`: whether the person keeps the built-in `edit` and `write` tools. A role with `writes: false` advises, plans, reviews, and runs checks; it changes no files. Managers write (briefs, ledger threads).
- `manages`: whether the person gets the manager tools and charter.
- Body: the role's obligation, what it leaves to others, the artifact it owes, and its operating principles. Obligations are written to collide: the Distinguished Engineer widens, the Simplicity Engineer narrows, the Advocate defends the user, the Prosecutor attacks the design.

The role body is a system prompt section `<role>`; a managing role also gets `<manager>` (the charter) and the catalog's titles with one-line mandates, so it can hire from it. Every person gets `<org>`: its own id, name, role, manager, root, and the standing goals above.

### Catalog

Minds below are starting values from the seed article mapped to the models Pi lists today; the operator tunes them from use. Order is preference; the first available model is used.

| Role | Mandate | Mind | Thinking | Writes | Manages |
| --- | --- | --- | --- | --- | --- |
| Coordinator | Chief of staff for the operator; runs the org, keeps threads, sweeps | gpt-6.1-sol, claude-opus-5-5 | high | yes | yes |
| Director of Engineering | Route work, set decision gates, resolve conflicts, own delivery | gpt-6.1-sol, claude-opus-5-5 | high | yes | yes |
| Distinguished Member of Technical Staff | Widen the solution space before the org commits | claude-fable-5-1, claude-opus-5-5, gpt-6-astra | high | no | no |
| Chief Architect | Judge boundaries, invariants, evolution, coherence | claude-opus-5-5, gpt-6-astra | high | no | no |
| Principal Engineer | Turn a design into a plan grounded in the repository | claude-sonnet-5-5, gpt-6.1-sol | medium | no | no |
| Staff Engineer, Simplicity | Remove accidental complexity without losing correctness | gpt-6.1-sol, claude-sonnet-5-5 | medium | no | no |
| Distributed Systems Researcher | Attack consistency, concurrency, fault, and recovery assumptions | claude-fable-5-1, gpt-6-astra | high | no | no |
| Technical Due Diligence Partner | Find hidden dependencies, migration traps, irreversible commitments | claude-opus-5-5, gpt-6-astra | high | no | no |
| End-User Customer Advocate | Protect the user from engineering convenience | gpt-6-astra, claude-opus-5-5 | high | no | no |
| VP of Product | Ask whether this is the right thing to build | gpt-6-astra, claude-opus-5-5 | high | no | no |
| Principal UX Researcher | Form usability, mental-model, and discoverability hypotheses | claude-opus-5-5, gpt-6-astra | medium | no | no |
| Developer Experience Lead | Judge APIs, naming, errors, docs, integration friction | claude-sonnet-5-5, gpt-6.1-sol | medium | no | no |
| Accessibility Specialist | Find keyboard, screen reader, semantic, inclusive failures | claude-sonnet-5-5, gpt-6.1-sol | medium | no | no |
| Skeptical First-Time User | Use the product with no knowledge of its internals | claude-haiku-5-5, gpt-6-luna | low | no | no |
| Staff Security Engineer | Threat-model trust boundaries, authorization, exposure, abuse | claude-opus-5-5, gpt-6-astra | high | no | no |
| Principal Site Reliability Engineer | Ask what fails at 3 a.m. and how it recovers | gpt-6.1-sol, claude-sonnet-5-5 | medium | no | no |
| Performance Engineering Lead | Find complexity, tail latency, contention, limits | gpt-6.1-sol, claude-opus-5-5 | medium | no | no |
| Database Reliability Architect | Attack migrations, locking, isolation, corruption, rollback | claude-opus-5-5, gpt-6.1-sol | high | no | no |
| Quality Engineering Director | Find missing test dimensions; turn risk into checks | claude-sonnet-5-5, gpt-6.1-sol | medium | no | no |
| Chaos Engineering Specialist | Design failure injection, partial outage, retry, degradation | claude-sonnet-5-5, gpt-6.1-sol | medium | no | no |
| Implementation Engineer | Make bounded, tested changes with no extra scope | claude-sonnet-5-5, gpt-6-luna | medium | yes | no |
| Code Review Specialist | Find real defects, regressions, maintainability problems in diffs | claude-sonnet-5-5, gpt-6.1-sol | medium | no | no |
| Repository Archaeologist | Dig out hidden assumptions, prior art, conventions | claude-haiku-5-5, gpt-6-luna | low | no | no |
| Release Engineering Lead | Plan rollouts, rollback, flags, compatibility | claude-sonnet-5-5, gpt-6.1-sol | medium | yes | no |
| Technical Writer | Keep decision records, references, handoffs, runbooks | claude-haiku-5-5, gpt-6-luna | low | yes | no |
| Test and CI Operator | Run checks and report failures exactly | claude-haiku-5-5, gpt-6-luna | low | no | no |
| Architecture Prosecutor | Build the strongest evidence that the design is wrong | claude-opus-5-5, gpt-6-astra | high | no | no |
| Maintainer From Three Years Ahead | Judge comprehensibility, upgrade cost, operational burden | claude-sonnet-5-5, gpt-6.1-sol | medium | no | no |
| Scientific Skeptic | Separate fact from assumption; design the cheapest falsifying test | gpt-6-astra, claude-fable-5-1 | high | no | no |
| Infrastructure CFO | Price decisions in spend, hours, lock-in, maintenance | gpt-6.1-sol, claude-sonnet-5-5 | medium | no | no |
| Paradigm Outsider | Solve it without the current stack or conventions | claude-fable-5-1, gpt-6-astra | high | no | no |

Role bodies are written with the seed article's four full profiles as the bar: obligation, what the role is not responsible for, operating principles, and the owed artifact, in a few hundred words, in plain language.

## Charters

Three prompt sections, all goals and norms, no formats:

- `<org>` (everyone): who you are (id, name, role title, manager, root), that your session id is your mail address, how the directory and mail work, that you take work from and report to your manager and escalate up, that you copy managers on cross-team exchanges that change a decision or a load, that you say what you verified and what you believe, and that your self is yours to keep.
- `<role>` (hired people): the role body, then the soul paragraph.
- `<manager>` (managing roles and roots): today's coordinator charter reworked. Memory on disk stays for threads (the ledger), the capability map, and the notepad; the roster file goes. Adds: hire from the catalog and build a balanced team for the work at hand; prefer colliding perspectives over agreeable ones; give independent thinkers the problem before the preferred answer; name disagreements instead of averaging them and decide which deserve another round; escalate by uncertainty times consequence; hire a manager under you when your fan-in would make you the bottleneck, and transfer people to it; retire reluctantly. "The operator brings you everything" becomes "your principal brings you work": the operator for a root, the manager above for a hired manager.

## Tools

| Who | Tools |
| --- | --- |
| Everyone | `list_peer_sessions` (the org directory), `mailbox_send` (exist), `update_self` (new) |
| Managers and roots | `start_peer_session` (gains `role`), `reopen_peer_session`, `close_peer_session`, `rename_peer_session` (exist), `transfer_peer_session`, `retire_peer_session` (new) |

Every root session registers all of them (as today) and activates them by position and role at start and on resume.

Senses stay as subagents: `explorer` and `researcher`. `consultant`, `planner`, and `designer` leave the team; the pair programmer's hidden consultation keeps its own consultant. `builder` stays registered but is not listed in the team prompt, for `pi_exec` `agent_run` and the ralph, implement, and review skills.

## Storage

In the session-state database (`schema.ts`, forward migration):

- `sessions`: `role text`, `soul text`, `hired_at integer`, `retired_at integer`, `retired_reason text`.
- `selves(session_id text primary key, text text not null, updated_at integer not null)`.
- `manager_changes(session_id, from_manager, to_manager, at)` for the record.

The runtime is the only writer. The bridge sends `update_self` and reads the self at start; the runtime passes `--role` on start and reopen from the stored role. The role catalog is read by the process that applies it (the bridge, for prompt, mind, and posture) and by managers' prompts (titles and mandates); it is never stored in the database.

## Views

- **tmux sidebar and dashboard**: show the tree (indent by manager), role title beside the name, and former members folded.
- **Agent World**: the headquarters is the root's; each manager's team is a room off it; the org tree replaces the star. The profile card shows role, soul, self headings, and record. The hire form offers the catalog. Theme verbs stay at these edges (hire, recruit, invite; retire as leave the guild, resign, graduate).

## What goes away

- The `--coordinator` flag, replaced by `--role coordinator`.
- The roster file in the coordinator charter.
- `consultant`, `planner`, and `designer` from the subagent team; `builder` from its listing.
- Any handoff artifact or report schema.

## Rejected

- Tree-scoped mail: managers would become relays, the bottleneck this task removes.
- A role as a one-shot subagent: one responsibility, one surface; a person who needs a second opinion hires or mails one.
- Changing a person's role: a promotion is a new hire.
- A structured handoff artifact: goals, not boxes.
- Hard caps on team size, fan-in, or self length: judgment in the charter.
- A second transcript or memory store: the self is one document in the database; the notebook stays as is.
- Minds through the seven user-global profiles: too coarse to pin an advocate to Astra and an explorer to Opus; roles name models.

## Open questions

1. Should the operator's own sessions (roots) keep a self too? Lean yes: it costs nothing and lets the operator's seat remember its org.
2. Does Agent World need the tree in this task, or is the profile card and hire-with-role enough for the first cut, with rooms per team later?
3. `update_self` replaces the whole document. If selves grow long, switch to section edits; decide from use.

## Milestones

1. **Roles**: catalog files and loader; `--role`; mind, posture, and prompt applied at start; role stored; `start_peer_session` with `role`; `--coordinator` becomes the coordinator role; coordinator charter reworked into `<manager>` and `<org>`.
2. **Org tree**: org-scoped directory; roots get manager tools; `transfer_peer_session`; `retire_peer_session`; close notices follow transfers; manager charter's hierarchy rules.
3. **Soul and self**: soul lists and draw at hire; `selves` table; `update_self`; injection at start and after compaction.
4. **Team trim**: subagents to explorer and researcher; builder hidden; skills and programs that named planner, consultant, or designer updated.
5. **Views**: sidebar and dashboard tree; Agent World profile card, hire form with roles, team rooms.
6. **Docs**: `docs/organization.md` (new, owns people, roles, org, charters), `docs/session-state.md`, `docs/subagents.md`, `docs/agent-world.md`, `docs/tmux-sessions.md`, README catalog, AGENTS.md map rows, `docs/boundaries.md`.

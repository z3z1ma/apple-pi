# Ledger task bundles

Ledger is apple-pi's plain-Markdown authority, memory, execution record, and learning loop. It lets a cold-start human or agent recover what outcome is owned, what authorized it, what is settled, what happened, what the evidence proves, and what should happen next. The transcript can inform the current turn; it is not durable project state.

Ledger is not a paperwork target, issue-tracker clone, or runtime database. The method applies to every task, while record depth scales with consequence. An exact typo or mechanical line edit can remain record-free. Work that creates or materially changes behavior, data meaning, an interface, persistence, side effects, a verification path, or a multi-session outcome benefits from one governing task.

## Fundamental model

- **Authority:** one task owns one coherent outcome. Active specifications and decisions govern intended semantics. Source and tests establish current behavior but cannot ratify a new product choice.
- **Provenance:** every execution-changing assumption is record-backed, explicitly user-ratified, or blocking. Pressure, examples, worker confidence, polished artifacts, and passing tests do not create authority.
- **Memory:** search live and historical tasks, supporting records, and repository owners before asking the operator to repay context the project already captured.
- **Evidence:** observations include procedure and limits. Worker reports are claims; tests prove their assertions; review independently attempts to falsify completion.
- **Compounding:** useful lessons move to the owner that changes future behavior—normal docs, decisions, tests, runbooks, packaged skills, or a new task. Task-specific history stays local.
- **Proportion:** choose the smallest complete solution and the lightest record set that preserves authority, continuity, and proof.

## Operating states

Ledger separates three responsibilities even when one session performs them sequentially:

1. **Shaping** resolves meaning, inspects existing context, researches unknown facts, ratifies assumptions, and establishes scope, acceptance, specifications, and decisions.
2. **Orchestration** selects Work Items and owners, sequences dependencies, commissions bounded execution and independent review, reconciles findings, and judges closure.
3. **Execution** owns one acceptance gap or Work Item, changes only that surface, journals material discoveries, gathers criterion-matched evidence, and blocks when ambiguity would change behavior or acceptance.

Shaping establishes authority; execution produces observations; orchestration judges the combined record. Typed `Agent`, `pi_exec`, Ralph, and review are actuation choices inside that model, not alternate task systems.

## Storage model

Each task is one self-contained directory whose name records when the task crystallized:

```text
.ledger/
  INDEX.md
  202608151430-implement-bounded-behavior/
    task.md
    specs/
    plans/
    research/
    decisions/
    evidence/
    knowledge/
    skills/
  history/
    INDEX.md
    202608141100-establish-prerequisite/
```

The exact task ID form is `YYYYMMDDhhmm-lowercase-kebab-slug`. The timestamp must be a valid calendar minute, and its date must match the `Created` header in `task.md`. A bundle contains exactly one executable root, `task.md`.

The model is intentionally local to one outcome. The task carries its shaping, execution Journal, evidence, review, retrospective, and distillation. It does not create a second global project wiki.

## Team and solo policies

For a team, the usual policy is:

```gitignore
/.ledger/
```

The workbench can then hold local context without entering every pull request. Ignored means local: it is not shared, backed up, or recoverable through Git.

A solo developer may omit the ignore rule and commit `.ledger`. The same Markdown task format and workflow apply in both modes. Committed task records will appear in ordinary Git review alongside implementation changes.

Each session reads and edits the `.ledger` in its own working directory. Linked worktrees therefore use their own committed ledger unless the operator deliberately supplies another task path as ordinary context. Apple-pi does not create, update, commit, or remove worktrees and never edits `.gitignore` automatically; storage policy belongs to the repository owner.

## Top-level task ledger

`.ledger/INDEX.md` is required. It is the live navigation index, not a second status database:

```markdown
# Task Ledger

- `.ledger/202608151430-implement-bounded-behavior/task.md` — Implement bounded behavior — Keep one production owner for the requested outcome
```

Closed tasks move to `.ledger/history/` and are listed in `.ledger/history/INDEX.md` with their terminal status, title, and description:

```markdown
# Task History

- `.ledger/history/202608141100-establish-prerequisite/task.md` — done — Establish prerequisite — Record the shared precondition other tasks depend on
```

Live status still lives only in that bundle's `task.md`. The history index is the greppable record of how a closed task ended.

## Task root

```markdown
Status: open
Created: 2026-08-15
Updated: 2026-08-15
Depends-On: .ledger/202608141100-establish-prerequisite/task.md

# Implement one bounded outcome

## Scope

The complete outcome this task owns.

## Non-goals

- Adjacent work deliberately excluded.

## Acceptance Criteria

- AC-001: One observable success outcome.
- AC-002: One observable boundary or failure outcome.

## Work Items

- [ ] WI-001: One stable implementation decomposition item.

## References

- `.ledger/202608151430-implement-bounded-behavior/specs/behavior.md`
- `.ledger/202608151430-implement-bounded-behavior/plans/implementation.md`
- `src/owner.ts`

## Assumptions

- Record-backed: the active specification establishes ...

## Journal

- 2026-08-15: Opened after inspecting ...

## Blockers

None.

## Evidence

Pending.

## Review

Pending.

## Retrospective

Pending.

## Distillation

Pending.
```

Canonical headers and exactly one level-one title are required. Acceptance criteria use stable `AC-###` IDs. Prefer executing `open` or `active` tasks whose Blockers section is `None.`.

Task status is `open | active | blocked | done | cancelled`. The implementing agent updates those records in the ledger as it works.

Work Items are optional implementation decomposition, not acceptance criteria. When present, the section appears only between Acceptance Criteria and References and contains canonical `WI-###` open, complete, or substantively cancelled rows. Agents update those rows with ordinary file edits and must preserve their canonical form. They do not close the task or satisfy acceptance criteria.

## Task dependencies

A task can depend on another task:

```text
Depends-On: .ledger/202608141100-establish-prerequisite/task.md
```

Dependencies keep the live identity form `.ledger/<task-id>/task.md`. Resolve that identity at the live path if present, otherwise at `.ledger/history/<task-id>/task.md`. A dependency is ready when the resolved `task.md` exists and its Status is `done`. Do not rewrite other tasks' `Depends-On` lines when archiving. Multiple paths are comma-separated. Dependency cycles are rejected.

This is the only cross-task graph edge. Supporting records cannot reach into another task's private artifacts. When another outcome has independent authority or acceptance, give it another task and connect the task roots. Plans replace parent-ticket hierarchies inside a bundle.

## Task-local record types

Create records only when a concrete consumer needs them. Every Markdown record except a skill starts with `Status`, `Created`, and `Updated`.

### Specification — `specs/**/*.md`

A shared behavioral contract: actors, boundaries, required and error behavior, scenarios, exclusions, assumptions, and acceptance mapping. Status: `draft | active | superseded`; follow only `active` specs.

### Plan — `plans/**/*.md`

Implementation sequence, source-backed change surfaces, criterion-to-check mapping, risks, and integration points. Status: `active | done`.

### Decision — `decisions/**/*.md`

A consequential choice with context, authority, steelmanned alternatives, consequences, and revisit conditions. Status: `active | superseded`; follow only `active` decisions.

### Research — `research/**/*.md`

A question or hypothesis, dated sources and methods, findings including null results, conclusions, and limits. Status: `active | done | superseded`. Safe task-specific captured material may live below `research/.storage/` but is not automatically compiled into model context.

### Evidence — `evidence/**/*.md`

An observation that should outlive one routine task check: observation, procedure, what it supports or challenges, and limits. Status: `recorded`. Routine criterion evidence stays in `task.md`.

### Knowledge — `knowledge/**/*.md`

Task-local vocabulary, conventions, or hard-won boundaries needed across iterations. Status: `active`. At closure, reusable project-wide knowledge is distilled into the repository's real maintainer documentation rather than accumulated as a hidden global ledger.

### Skill — `skills/<slug>/SKILL.md`

A task-local candidate procedure with precise trigger, prerequisites, procedure, and validation. When referenced, an agent must read it explicitly as an ordinary task record; it is not ambient or host-discoverable merely because it exists. Promote proven recurring procedures to the repository's configured skill directory.

Review, routine evidence, Journal, Blockers, Retrospective, and Distillation remain in `task.md`; standalone duplicate review records are unnecessary.

## Agent guidance

The ledger extension appends the workbench contract on `before_agent_start`. Interactive children and `pi_exec` workers load that same file via `--no-extensions` plus `-e`; they do not discover other package extensions, and they do not load `pi_exec` or the subagent manager. Children also load `session_search` and MCP; workers load `session_search`. The Advisor does not receive the contract.

`ledger_add` creates `.ledger/INDEX.md` when absent, a timestamped task directory, structural `task.md`, every standard supporting directory, and one live index row with title and description. A new task begins with explicit shaping placeholders and a blocker; it is not execution-ready.

`ledger_close` archives a live task as `done` or `cancelled`. It updates `Status` in `task.md` when needed, moves the bundle to `.ledger/history/`, removes the live index row, and appends a history row that includes the terminal status, title, and description. It does not inspect work items or judge completeness.

Those tools refuse collisions and do not list, inspect, select, or execute existing tasks. Agents use ordinary read and edit tools after creation and before close.

## Workflow skills

Thirteen descriptively named lifecycle skills absorb the former stage-local Ledger skills without adding a `ledger-` prefix. The general `pi-exec`, `review`, and `ralph` skills keep distinct responsibility boundaries.

| State | Ledger lifecycle skills | Responsibility |
| --- | --- | --- |
| Shaping | `task-shaping`, `implementation-planning` | Search prior context, resolve ambiguity, ratify assumptions, and establish task/spec/decision/plan authority. |
| Execution | `root-cause-debugging`, `test-first-development`, `plan-execution` | Own one acceptance gap or Work Item, journal discoveries, and gather bounded evidence. |
| Orchestration | `work-item-orchestration`, `parallel-orchestration` | Sequence dependencies, bind cold-start handoffs, coordinate bounded workers, and reconcile their claims. |
| Review | `review-commissioning`, `review-reconciliation`, `completion-verification` | Commission review, disposition findings, and map claims to fresh criterion evidence. |
| Workspace and closure | `workspace-isolation`, `task-closure` | Preserve isolation and continuity, distill learning, judge honest terminal state, and present operator-owned integration choices. |
| Compounding | `skill-authoring` | Turn repeated toil or instruction failures into empirically tested packaged procedures. |

The lifecycle may invoke independent skills without redefining them: `pi-exec` remains general composition guidance, `review` remains general code review, and `ralph` provides bounded fresh-context loops for either caller-owned goals or prepared Ledger tasks.

Typical flow:

```text
shape → research/specify as needed → plan → execute → review → verify → distill → operator integration
```

The runtime identifiers remain unchanged: `Agent` is typed collaboration, `pi_exec` is bounded composition, and `ledger_add` / `ledger_close` create or archive task structure. Ralph is implemented as a `pi_exec` skill, not an extension. Each iteration is a fresh program-only worker; the caller bounds the batch, then invokes `/skill:review` separately and reconciles the Ledger before deciding on another batch.

Not every task needs every record or skill. A small but non-trivial task may need only `task.md`, and exact trivial work may need no task mutation. Research, specs, decisions, plans, standalone evidence, knowledge, and candidate skills appear only when they materially govern execution or preserve a finding worth its storage cost.

## Distillation

Distillation prevents an ignored workbench from becoming a knowledge graveyard. At each iteration and closure, route durable outcomes to their real lasting owners:

- behavior or operator contract → normal repository documentation;
- architectural choice → the repository's ADR convention;
- vocabulary or maintenance boundary → handbook or maintainer docs;
- recurring error-prone procedure → a project skill or runbook;
- independent unfinished work → a new timestamped task;
- task-specific history with no future consumer → remain in this bundle.

External wiki, issue-tracker, or service writes remain human-authorized external actions. The task can name a pending promotion or hold a safe draft, but must not claim publication without observed evidence.

A substantive no-promotion rationale is valid: for example, tests and implementation own a bounded invariant and no reusable operational knowledge emerged. `None`, `N/A`, and `Pending` are not valid distillation.

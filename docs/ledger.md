# Ledger task bundles

`.ledger` is apple-pi's plain-Markdown workbench for non-trivial work. Each task is one self-contained directory whose name records when the task crystallized:

```text
.ledger/
  README.md
  202608151430-implement-bounded-behavior/
    task.md
    specs/
    plans/
    research/
    decisions/
    evidence/
    knowledge/
    skills/
```

The exact task ID form is `YYYYMMDDhhmm-lowercase-kebab-slug`. The timestamp must be a valid calendar minute, and its date must match the `Created` header in `task.md`. A bundle contains exactly one executable root, `task.md`.

The model is intentionally local to one outcome. The task carries its own shaping, execution ledger, evidence, review, and learning. It does not create a second global project wiki. When a result deserves to become durable project authority, it is distilled into the repository's normal docs, ADRs, handbook, tests, or discoverable skills.

## Team and solo policies

For a team, the usual policy is:

```gitignore
/.ledger/
```

The workbench can then hold local context without entering every pull request. Ignored means local: it is not shared, backed up, or recoverable through Git.

A solo developer may omit the ignore rule and commit `.ledger`. The same graph and runtime work in both modes. Committed task records will appear in ordinary Git review alongside implementation changes.

This determines worktree behavior:

- When `.ledger` is committed and current in a linked worktree, that worktree's own ledger is authoritative; use `root` and omit `ledger_root`.
- When `.ledger` is ignored and remains only in the main checkout, target implementation with `root` and pass the main checkout as `ledger_root`.

The ledger tool allows only roots sharing the trusted session repository's Git common directory. It does not create, update, commit, or remove worktrees. The human and orchestrating model own those choices. Apple-pi never edits `.gitignore` automatically; storage policy belongs to the repository owner.

## Top-level task ledger

`.ledger/README.md` is required. It is a navigation index, not a second status database:

```markdown
# Task Ledger

- `.ledger/202608151430-implement-bounded-behavior/task.md` — Implement bounded behavior
- `.ledger/202608141100-establish-prerequisite/task.md` — Establish prerequisite
```

Every executable or dependency task must be listed. Status lives only in that bundle's `task.md`, so activation and closure cannot leave two status copies inconsistent.

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

Work Items are optional implementation decomposition, not acceptance criteria. When present, the section appears only between Acceptance Criteria and References and contains canonical `WI-###` open, complete, or substantively cancelled rows. The `ledger` tool mutates those rows through `parseTaskDocument` and `mutateTaskWorkItems`. They do not close the task or satisfy acceptance criteria.

## Task dependencies

A task can depend on another task:

```text
Depends-On: .ledger/202608141100-establish-prerequisite/task.md
```

Dependencies must use canonical task-root paths and must be `done` before execution. Multiple paths are comma-separated. Dependency cycles are rejected.

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

A task-local candidate procedure with precise trigger, prerequisites, procedure, and validation. It enters the compiled graph when referenced, but it is not ambient or host-discoverable merely because it exists. Promote proven recurring procedures to the repository's configured skill directory.

Review, routine evidence, Journal, Blockers, Retrospective, and Distillation remain in `task.md`; standalone duplicate review records are unnecessary.

## Workflow skills

## Operations hub and active task

`/harness` and `/ledger` open the ledger task picker. `/` focuses the fuzzy query (non-prefix title and path fragments match). Enter inspects. `s` selects the active task. `c` clears it. Escape clears search, then closes detail, then closes the hub.

The `ledger` model tool supports `list`, `inspect`, `select`, `clear`, and `mutate_work_items`. Selection appends a branch-local pointer `{schemaVersion:1, ledgerRoot, taskPath}` only. Clearing appends a tombstone. Reconstruction folds `sessionManager.getBranch()` last-valid-entry-wins, including tombstones, and ignores malformed records individually. A stale latest pointer stays visible with its exact reason (`missing`, `moved`, `unindexed`, `malformed`, `unrelated`, `not_regular_file`, `symlink`) and is never replaced by an older pointer. Print/RPC modes keep the tool and skip overlays.

Apple-pi packages the complete lifecycle as on-demand Pi skills:

```text
/skill:ledger-shape-task
/skill:ledger-research-task
/skill:ledger-specify-task
/skill:ledger-plan-task
/skill:ledger-execute-task
/skill:pi-ralph
/skill:ledger-distill-close-task
```

Typical flow:

```text
shape → research as needed → specify/decide → plan → inspect → /skill:pi-ralph → distill
```

Not every task needs every record. The skills separate procedures; they do not require ceremony. A small but non-trivial task may need only `task.md`. Research, specs, decisions, plans, evidence records, knowledge, and candidate skills appear only when they materially govern execution or preserve a finding worth its storage cost.

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

## Migration from `.10x`

The runtime deliberately has no dual parser. `.10x` inputs return a migration error. Move each executable outcome into one timestamped task bundle, keep only task-specific supporting records with it, convert parent plans into task-local plans or separate tasks, rewrite dependencies, promote globally reusable authority to normal repository documentation, add every task to `.ledger/README.md`, and inspect the task with the `ledger` tool.

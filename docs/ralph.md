# Ledger-backed Ralph work loops

Ralph executes one shaped `.ledger` task as a sequence of fresh, bounded contexts:

```text
compile task graph → execute → judge → close or start a fresh iteration
```

The task bundle is semantic authority. User-local JSONL receipts record machine execution state but cannot replace task evidence, blockers, retrospective, or distillation.

See [`ledger.md`](ledger.md) for shaping, record types, team/solo storage policy, and the full skill workflow.

## Executable root

The root is exactly:

```text
.ledger/<YYYYMMDDhhmm-lowercase-kebab-slug>/task.md
```

The timestamp must be a valid calendar minute whose date matches the task's `Created` header. The root must be a regular, non-symlink Markdown file, listed by path in `.ledger/README.md`, with `Status: open` or `Status: active`, canonical headers, exactly one title, stable `AC-###` acceptance criteria, and the sections documented in [`ledger.md`](ledger.md). Blockers must be `None.` before execution.

`Depends-On` may name only other canonical task roots. Every dependency must be indexed and `done`. References may name supporting records in the same task bundle or ordinary repository source pointers. Cross-task supporting-record links are rejected; use `Depends-On` for a cross-task relationship.

A task may optionally place `## Work Items` between Acceptance Criteria and References. Its body contains only canonical rows: `- [ ] WI-001: description`, `- [x] WI-001: description`, or `- [-] WI-001: description — Cancelled: substantive reason`. IDs are unique uppercase `WI-###` values. Malformed, misplaced, duplicate, or placeholder rows fail graph compilation; no Work Items section remains compatible.

## Deterministic graph compilation

Ralph follows only explicit semantic edges:

1. root `task.md`;
2. its `Depends-On` task roots, recursively;
3. task-local paths in the root References section;
4. from included supporting records, paths in References, Related Records, Relates-To, or Authority And Provenance.

Dependency task roots are included for completion context, but their private supporting records are not imported into the current task. Ordinary task records cannot cross the owning bundle.

Included record lifecycles are checked before a model call:

| Record | Required status |
| --- | --- |
| dependency task | `done` |
| spec | `active` |
| plan | `active` or `done` |
| decision | `active` |
| research | `active` or `done` |
| evidence | `recorded` |
| knowledge | `active` |
| skill | frontmatter-bearing `SKILL.md` |

Missing, superseded, blocked, cyclic, symlinked, non-canonical, unindexed, path-escaping, or cross-task records fail visibly. Ralph does not recursively harvest paths from Journal, Blockers, Evidence, Review, Retrospective, Distillation, source files, or arbitrary prose.

The context packet is root-first, then deterministically ordered by record kind and bytewise path. Every record carries its path and SHA-256 digest.

## Commands

```text
/ralph                          # open the Ralph operations hub (TUI) or a text summary (print/RPC)
/ralph inspect .ledger/202608151430-example/task.md
/ralph start .ledger/202608151430-example/task.md
/ralph step <run-id>
/ralph run .ledger/202608151430-example/task.md
/ralph run .ledger/202608151430-example/task.md --root ../task-worktree --ledger-root /absolute/main-checkout
/ralph status [run-id] --root ../task-worktree
/ralph stop <run-id> --root ../task-worktree
```

- `inspect` validates and describes the graph without a model call or mutation.
- `start` requires a trusted project, active model, and a Git worktree with `HEAD`. Dirty checkouts are allowed. It records receipt metadata before changing an open task to active.
- `step` performs one complete fresh executor → fresh judge iteration.
- `run` continues autonomous iterations only while judgment says `iterate`. Ralph does not abort a run for token spend, elapsed time, or role-turn count. `step` is one iteration because that is the command, not a resource ceiling. Operator stop, judge close/block/stop, and concrete faults remain the terminal paths.
- `status` validates and replays the user-local receipt.
- `stop` aborts active work, waits for it to quiesce, and records an `operator_stop` terminal cause.

Argument-less `/ralph` opens the Ralph fleet in the operations hub. The live widget shows task path, iteration, stage, work-item counts, current activity, next objective or gate, elapsed time, and usage. Accumulating finished iterations linger. Enter opens detail; `s` then `s` stops an owned run. Print/RPC modes skip overlays and widgets.

The model-facing `ralph` tool is the primary orchestration interface; the slash command is human operational parity. The tool uses `task`, `root`, and `ledger_root`:

- `root` selects the implementation worktree and defaults to the session worktree;
- `ledger_root` selects the linked checkout containing authoritative `.ledger` and defaults to `root`;
- `step`, `status`, and `stop` use `root` to locate the worktree-keyed receipt.

Both root values may be absolute or session-relative. Ralph canonicalizes them and accepts only linked worktrees sharing the trusted session repository's Git common directory. Human `step` and `run` execute in the background so status and stop remain available.

## Fresh-role guarantees

Ralph reuses apple-pi's managed subagent service; there is no second model runner.

- Each executor and judge gets a new agent ID and Pi session.
- No role is resumed or inherits parent conversation.
- Internal role IDs cannot be publicly resumed, steered, listed, or inspected.
- Role prompts are packaged procedures whose hashes enter receipts.
- Executor tools: `read`, `grep`, `find`, `ls`, `bash`, `edit`, and `write`.
- Judge tools are read-only: `read`, `grep`, `find`, and `ls`.
- Extensions, ambient skills, project context files, and parent conversation are disabled inside role sessions.
- Any role compaction invalidates the curated fresh context and stops the run.

The executor receives the compiled graph and one bounded objective. It cannot edit `.ledger`. It returns structured summary, criterion observations, Journal entries, Blockers, Retrospective, Distillation, and an optional next objective. The controller records owned task sections with digest compare-and-swap.

The judge receives the current task graph, executor report, and bounded workspace diff. Independent review is a separate `/skill:review` program when the parent session wants it.

## Closure

A judge may choose:

- `close`: only when the implementation and every gate support closure;
- `iterate`: another fresh executor can complete one named in-scope objective without invented semantics;
- `blocked`: user ratification, authority, task dependency, or contract correction is required;
- `stop`: another iteration is inappropriate.

Even a judge's `close` cannot bypass deterministic closure checks:

- every task criterion has substantive observed Evidence;
- the judge assessed every criterion as satisfied;
- dependencies remain done and Blockers remain absent;
- Retrospective is substantive;
- Distillation contains performed promotion, an honest pending human-owned external action, or a substantive no-promotion rationale;
- every Work Item is complete or substantively cancelled, with no parse issue.

Executors may only propose completion evidence for known open work items. Judges assess exactly that set, and the controller alone completes confirmed IDs under its task-bundle lease. Rejected IDs remain open and are named in the next objective or terminal reason.

Only then does the controller set `Status: done`. The bundle is not moved or deleted.

## Workspace and authority boundaries

Ralph uses one implementation checkout and runs roles sequentially. The checkout may already be dirty. It may target a linked worktree supplied by the orchestrating model or human, but never creates, updates, commits, removes, or otherwise manages worktrees. Those lifecycle choices remain outside Ralph. It also never commits, stages, pushes, deploys, publishes, resets, cleans, stashes, or repairs a failed workspace.

When `.ledger` is committed and current in the implementation worktree, omit `ledger_root` and Ralph uses that copy. When `/.ledger/` is ignored and remains in the main checkout, pass the main checkout as `ledger_root`. Executors always run against `root`; controller task mutations always target `ledger_root`. Read tools may inspect the external `.ledger` subtree, but writes there remain controller-only and other files in the ledger checkout remain outside role authority.

The executor policy blocks common forms of:

- Git and branch mutation;
- remote, deployment, publishing, infrastructure, and cluster actions;
- network CLIs and SSH/file transfer;
- shell batches, redirection, external paths or variables, direct filesystem mutation, dependency installation, and opaque interpreters;
- writes outside the project, through symlinks, into `.git`, or into `.ledger`.

This is a workflow guard, not an OS sandbox. Trusted local scripts and dependencies can conceal side effects. External, destructive, privileged, irreversible, or materially costly actions remain human-owned.

An external or in-tree ledger is protected by a task-bundle lease, graph-hash checks before controller mutations, and root-task digest compare-and-swap. Executor writes that change compiled ledger authority become `authority_required`. Concurrent ledger mutation during a controller write becomes `workspace_conflict`; it is never silently adopted.

The judge receives a `git status` plus `git diff HEAD` preview, truncated if large. Submodules and in-progress merge/rebase/cherry-pick are refused at start. Leases cover both the implementation workspace and authoritative task bundle: different tasks in different worktrees may proceed independently, while the same workspace or same authoritative task cannot execute concurrently.

Human edits in the implementation checkout are ordinary dirty work. They do not abort the run.

## Receipts and recovery

Receipts live outside the repository:

```text
$PI_CODING_AGENT_DIR/ralph/runs/<project-hash>/<run-id>.jsonl
```

The default agent directory is `~/.pi/agent`. Receipts are keyed by canonical implementation worktree. Schema v2 stores both the absolute implementation `projectRoot` and absolute `ledgerRoot` plus `taskPath`. Events are append-only and sequence-numbered. Replay validates schema, structurally valid roots, task path, immutable metadata, legal state transitions, iteration progression, monotonic token usage, and recorded budget fields before trusting state. Recorded budget fields and any historical workspace snapshots are receipt compatibility, not runtime abort thresholds. Status and audit replay do not require the ledger checkout to still exist; continuing execution does.

Schema-v1 `.10x` receipts are retained as audit files but are not resumable and are omitted from current run listings. Addressing one directly returns an explicit legacy error; there is no dual execution runtime.

Events contain project/task paths, graph and workspace hashes, role skill hashes, child session paths, usage, compaction count, structured role output, gates, and recoverable run state.

Receipts and persisted role sessions can contain project-sensitive text and absolute paths. Protect the Pi agent directory. Never put secrets or regulated personal data in ledger records, prompts, outputs, logs, or receipts.

A receipt ending inside an agent stage is interrupted. A later invocation records that terminal state and creates no resumed role context.

# Retain peer accounting without retaining temporary people

## Completed approval record

The operator approved all 31 diff hunks for [ticket 15](tickets/15-keep-history-on-peer-disposal.md), committed as ebb54f5b: durable caller/temporary-identity facts, migration 29, caller accounting and retained assignment spans. All thirteen committed blobs matched the chair-tested hashes. This approval covers the code increment, not a live daemon restart or a claim to recover all old history.

## Three different relationships

Temporary here means a `pi_exec` program-owned person, distinct from a lasting colleague who is merely idle or at home.

| Question | Recorded basis | Effect |
|---|---|---|
| Who owns a program's spend? | Immutable creation callers, recursively to the first lasting person | Charge once to that caller under its membership when observed |
| Who reports to whom? | Initial known manager plus ordinary historical moves | Preserve actual structural ancestry, including disposal reparenting |
| Who holds a surviving task? | Retained assignment intervals | End an open span at disposal; retain earlier work history |

If caller R creates temporary P which costs $2 and P creates Q which costs $3, R receives those $5 of compute once, rather than excluding them or charging nested spend twice. Moving P/Q changes their reporting tree, not the accounting beneficiary. Questions and operator mail/escalations use the same lasting-caller attribution, while generic active-person membership still excludes temporary people. This is accounting, not task-level cost allocation. For peer compute, the dropped-work estimate follows the accounting caller's focus at observation time, not the emitting peer's focus.

A caller is the person who created a peer, not necessarily its current reporting manager. A hello is the bridge's initial or reconnect handshake with the runtime. A first-sight baseline records cumulative transcript spend already present without charging it as new spend.

Spend lands when the runtime observed it. Missed spend during an outage still lands on reconnect, not at an invented inference timestamp. A new temporary identity records launch ownership, immutable caller and a zero cost baseline atomically before provisional work/process creation. Its first positive hello reporting $3 is therefore real spend. Ordinary and legacy first-sight baselines remain unchanged.

## Cleanup ends participation, not past work

Temporary person/process cleanup still occurs, while Pi transcript files remain retained. For an unblocked task with an asserted cost of delay of $5/hour, an assignment held during [0h,1h) retains $5 of in-progress delay after peer disposal at 2h. This is the task's asserted delay cost, not a staffing rate or verified external loss. Its remaining assignment ends with a non-finished reason; existing ends/outcomes are unchanged. Disposal does not complete the task or earn value.

Internal ephemeral tasks held only by temporary people remain excluded from financial obligations. When two temporary holders are discarded separately, retaining the first ended span must neither turn it into a lasting holder nor prevent final internal cleanup. Ledger tasks and work with real lasting assignment history survive. Existing retained task posts/work_changes and operator threads already survive; no duplicate history store is added.

Durable temporary IDs extend the existing cannot-reopen guard at both session-start and hello admission. Reusing a discarded ID for an ordinary hire, another program or ordinary transcript resume is refused before person/incarnation/facts writes. A retained transcript preserves its UUID but does not preserve launch environment flags; it is retained history, not permission to reactivate the temporary identity. Valid live program first hello/reconnect and ordinary new identities remain admitted.

## Migration is observation, not invented history

Migration 29 appends known caller facts from surviving launch rows before startup cleanup. It does not fabricate a creation time or zero baseline for legacy peers. Previously discarded identities can remain recognizably temporary while their caller is unknown. A later launch's caller does not establish earlier ownership when prior discard evidence makes the ID ambiguous; the identity's accounting caller stays unknown, and its initial ancestry is not guessed from today's row. Recorded manager changes still apply at their own times. An unknown caller or null initial ancestry is a conservative reader result, not a new stored migration event. Unknown callers, already-deleted assignment spans and existing baseline/measurement limits stay qualified; this is not complete historical reconstruction. The old blanket exclusion of program spend is removed for supported ownership.

## Settled review and verification

Morag's renewed author run reports 151/151 across eleven relevant suites with `--maxWorkers=2`, Node/web typecheck, loader, Biome on six files, whitespace and context lint on 160 files. All thirteen scoped hashes stayed unchanged across her final checks, including bridge context. Earlier 139/141 snapshots do not certify these later revisions. Package dry-run includes the changed source files, not installed-package behavior.

New producer tests use actual Runtime methods and deliberately stop at applyWork before process launch, then exercise the real fact writer/disposal. They cover baseline, nested attribution, event-time membership, retained spans/posts/mail, sequential cleanup, migration, SQL-trigger rollback/retry and ordinary/fresh-program ID-reuse attempts. Existing program lifecycle tests are separate process-level evidence, not claimed by the pre-launch fixture.

Lucette's final Standards/Intent report (`t-f093a35f`) rules the thirteen-path slice safe to land after the named repairs, with no unresolved blocker. Her current-snapshot thirteen relevant suites passed 167/167 with `--maxWorkers=2`; Node and web typechecks, loader, Biome on six files, tracked/new-file whitespace and context lint on 160 files passed. Thirteen before/after/final hashes match the author freeze. Scope is five session-state sources, the new peer-history test, organization documentation and six contexts, including bridge context. Agnieszka separately passed Agent World build consistency 1/1 and verified source package inclusion. The isolated review copy matches all thirteen checked files; it was not independently tested as a whole worktree.

The widened board's independent checks report no remaining blocker in their respective lenses:

- Waylon reproduced the sequential cleanup receipt mismatch, then verified actual file-removal failure preserves launch ownership and retry after reopening the isolated database completes cleanup. His old pre-upgrade admission/transfer-method reruns also verify ambiguous callers and earlier descendant ancestry stay unknown, while actual post-change ancestry remains usable. His current focused non-bridge peer-history/cost-history run passed 26/26 with four bridge cases skipped.
- Tendai reproduced ordinary transcript resume through native SessionManager.open and the real bridge recreating a temporary UUID and charging new spend to its old caller. After repair, his four real-bridge cases passed: explicit close/no state writes for rejected identities, and ordinary/program first hello and reconnect positive controls. All thirteen hashes matched before and after his run.

Those are separate executed-method/bridge checks, not inherited author counts or native CLI end-to-end proof. Waylon's old runtime methods used current dependency imports and stopped before process launch; his original cleanup reopen experiment used a persistent isolated database. The caller-focus explanation is an accepted convention, not a withdrawn production defect. These source-review checks claim no full-suite, live-runtime/database, installed-tarball or `pi_exec` composition proof. The later [authorized rollout](rollout.md) separately records the live daemon/schema verification. A separately reported `pi_exec` type-check failure occurs before execution; this review does not establish that these tools can run through that composition path.

## Next step

1. Operator approval and the scoped commit are complete; the review copy and committed blobs match the checked boundary.
2. [Ticket 16: `/org`](tickets/16-org-command.md) and [ticket 17: manager guidance and scripted isolated demonstration](tickets/17-teach-evidence-informed-adaptation.md) are approved and committed as 7bdb93c9 and 04f3a320.
3. Explicit rollout authority was subsequently obtained; the replacement runtime and live schema 29 were verified separately from these source checks. The operator-facing organization-root session was reloaded and a refreshed native inspection succeeded. See [rollout evidence and client verification](rollout.md).

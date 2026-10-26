# Approval record: explanation of spend on dropped work

## Status and next step

[Ticket 13](tickets/13-spend-on-dropped-work.md) was approved (28/28 diff hunks) and committed as `0443d9fd`. Final independent checks passed 48/48 focused tests, loader, Node/web typecheck, Biome and context lint (157 files); seven reviewed file hashes stayed unchanged. These are scoped checks, not a full-suite, installed-package or live-rollout claim. The next implementation is [ticket 14: scenarios and predictions](tickets/14-scenarios-and-predictions.md).

The decision framing below records what was presented before approval. Its references to pending review and six paths describe that earlier draft; final review also included the added fitness-test context file.

## Decision presented

Approve ticket13's explanatory breakdown in org_fitness. Recommendation: approve after independent review closes. It identifies already-counted compute and delay associated with tasks now recorded as cancelled or replaced, not whether abandoning them was a bad decision. It changes no economic events or dollar total.

## Worked example

A task has already accrued $12 of inference expenditure (compute) and $5 of modeled delay cost; the organization has no earned value in this example, so net fitness is -$17. After the task is recorded cancelled, the breakdown explains that same $12 + $5 on the task. Net remains -$17, not -$34. A supersedes link from a replacement to that task provides the other explicit dropped-work annotation; duplicate links do not double-charge it.

Classification uses current recorded cancellation/replacement and can become known after the requested spend window. This changes an explanation, not the old dollar arithmetic.

## Compute attribution is an estimate

Runtime work changes and their task-thread posts commit atomically. Their retained records say when a person took, received, focused, finished or was unassigned work. Replaying them includes focus established before the selected window. It does not use today's focus or assume every held task was focused.

A known eligible focused task receives the compute observed then. A missing/unknown focus, a foreign task, or an internal temporary-only step is unattributed instead. Known ordinary non-dropped work is not mislabeled unattributed. Same-millisecond focus transitions follow message sequence and are included at the compute timestamp; there is no shared causal sequence with cost events. The result labels compute attribution estimated.

This reuses retained facts, not new telemetry. A missing retained work-change/post pair cannot be recovered from current focus, and the reader does not promise to detect every arbitrary deleted transition. Existing [ticket 15 peer-history limitations](tickets/15-keep-history-on-peer-disposal.md) remain.

Delay is the task's already-evaluated delay, not an estimate from focus. Subtree filtering keeps the existing explanatory task/person scope and leaves the root total unchanged. Native output carries task/link references and explicitly says this is not an extra charge or a waste verdict.

## Verification boundary

Author45/45 fitness/work tests; Node/web typecheck, loader, explicit Biome4 files, diff check and context lint156 passed. Fixtures use production changeWork and postToThread in one transaction. They cover before-window focus, switch/clear and promotion, missing post, timestamp ties, foreign/internal focus, supersession/no-link comparison, duplicate links, unchanged total and subtree behavior. Independent review is pending and will be reported separately on the approval page.

Approve only the six reviewed source/test/docs/context paths, not unrelated task/history changes. No full suite, packed install, complete peer-history or live rollout claim. After commit, proceed to the approved optional scenario/prediction adapter and retained peer-history repair.

# Approve recorded impacts and findings

## Decision

Approve committing ticket12's read-only link projection into org_fitness. Recommendation: approve after independent review closes. The evaluator already accepts dollar impacts; this slice supplies recorded link assertions to it and exposes findings as evidence. It adds no table, permission policy or automatic verification.

## What changes the number

A link may carry `data.impact` with numeric `dollars`, `kind` (`incurred` or `estimated`), and optional numeric `at` (epoch milliseconds). When `at` is absent, link creation supplies the time. Signed incurred dollars combine algebraically: negative losses subtract, positive gains add.

| Recorded assertion | Dollar effect |
| --- | --- |
| Incurred damage of -$120 at hour 1 | Subtract $120 in the window containing hour 1 |
| Incurred gain of $10 at hour 1 | Add $10 in that window |
| Estimated damage of -$120 | List the estimate, charge nothing |
| `fixes` or `supersedes` with no impact | No effect by itself |
| Backdated incurred impact recorded at hour 3 for hour 1 | Restate the hour 1 window, preserving window additivity |

Impacts are current recorded assertions, not a reconstruction of what was known then. Their source link, endpoints and recorder are inspectable. Originating organization follows historical structural ancestry at the impact's time. Subtree filtering narrows evidence and contributions, not the organization's total.

The harness does not prove damage, verify who should accept findings, or prevent duplicate economic assertions. Native guidance says to record what actually happened, never an avoided loss or value/cost already counted. Avoided outcomes belong in optional scenarios.

## Findings are not dollars

A finds link targeting a task is listed with its recorded reviewer and accepted/rejected/unresolved status at the cutoff. Results group by task and by reviewer (the recorder), not an invented quality score. The traffic window selects when findings were created, not when they were resolved. Resolution exactly at the cutoff counts as resolved. Finishing a fix task still earns its own recorded value under the existing rules; neither fixes nor supersedes automatically reverses another task's value.

## Checks and boundaries

Author checks: fitness/work40/40, Node/web typecheck, explicit-path Biome, diff check and context lint154/154. Tests cover negative and positive incurred impacts, estimates, no-impact links, recorder provenance, backdating/partition invariance, malformed impact shapes, historical organization isolation, finding resolution cutoff and native rendering. Independent review is in progress; its final result will be stated on the code sign-off page.

No full-suite, live rollout or complete peer-history claim. Existing ticket15 peer/history omissions and prior legacy measurement conventions remain; this slice does not repair or reauthorize them.

Approval covers the six reviewed source/test/docs/context paths only. It does not cover unrelated ledger/history edits. After commit, proceed to spend-on-dropped-work explanation, then optional scenarios and remaining peer-history repairs.

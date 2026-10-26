Type: interrogation
Status: resolved
Blocked by: 21

## Question

Where does the value of work come from? F needs useful value for completed work, its timeliness, and the cost of unfinished work (otherwise an idle, empty organization scores well). Tasks carry no value today. Decide who or what gives work its value (the operator, the assigning manager, a default per task, priorities, inferred from the work), how delay discounts it, and how rework lowers it while verification is deferred.

## Answer

The operator, 2026-10-24: whoever creates or assigns a task estimates its value and its cost of delay, written in `task.md`; the operator corrects any estimate he disagrees with. Every term is priced in dollars, because compute cost already is: the value of work, the cost of each day of delay, and the price of a minute of the operator's attention. A task's realized value is its value minus the cost of delay up to delivery; unfinished work keeps losing its cost of delay, so an idle, empty organization scores negative; a later `supersedes` link takes back the superseded task's value, which weighs quality without a verification step. The price of the operator's attention is one parameter whose default the spec settles with the operator.

Example: "Fix flaky test", value $50, cost of delay $5 per day, delivered on day 2 ($40), $3 of compute, 10 minutes of operator attention at $2 per minute: realized net value +$17.

Revised by the operator's review of the spec, 2026-10-25: `supersedes` no longer takes value back (supersession is a relationship, not a loss of value); value is earned once at task completion; delay starts when work becomes an obligation; the attention price stays in the model but the term is unmeasured; past windows are restated under current valuations. See [spec.md](../spec.md).

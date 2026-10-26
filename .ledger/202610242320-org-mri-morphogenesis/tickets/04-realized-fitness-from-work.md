# 04: One evaluator and realized fitness from work

Part of the approved spec [../spec.md](../spec.md); its Terms table defines obligation, completion, window, horizon, scenario, impact, and the other words used here.

**What to build:** Build the pure evaluator U over economic events (value earned at a time, delay accrued over an interval at a rate per hour, compute spent at a time, impact incurred at a time) and the history adapter for value and delay; compute and impacts follow in later tickets. Any person can read the realized fitness of their whole organization over a window they state (`since`, optional `until`, default now) with the read-only `fitness` tool, installed for every person. Value is earned once, at a task's completion; a cancelled task earns nothing and stops accruing delay at its close. Delay accrues per hour from each valued task's recorded open until its close. The result gives the total, the rate per hour, contributions with their source, an optional narrowing of the contributions to a subtree (an explanation, not a score), and valuation coverage and provenance: how many outstanding and closed tasks are unvalued and their share, marking the number incomplete when any are, and the shares of value marked as agents' estimates and unattributed. `docs/organization.md` describes fitness.

**Blocked by:** 01 (Record when tasks open and close), 03 (Value and cost of delay on tasks).

**Status:** ready-for-agent

- [ ] The evaluator, given hand-built events, satisfies partition invariance: U over two adjacent windows equals U over their union, including an event exactly at the boundary (it counts in the later window) and fractional hours.
- [ ] The spec's worked example without compute gives value and delay of $0 and $10 for hours 0 to 2 and $50 and $7.50 for hours 2 to 4.
- [ ] Against a temporary state database, a task with three assignees earns its value once; a ledger task closed `cancelled` earns nothing and accrues no delay after its close.
- [ ] An unassigned ledger task later assigned, completed, and archived gives the same fitness for an earlier window before and after the archive.
- [ ] An organization whose only work is a valued, unassigned task scores negative over any window after its open.
- [ ] An unvalued task contributes no value or delay, counts in coverage, and marks the result incomplete; a `Value: $0` task with `Cost of delay: $5/hour` is valued and accrues delay; a value marked `(estimated by Name)` counts in the estimated share and an unmarked value in the unattributed share.
- [ ] After an operator edit of a task's value, fitness for a past window is restated under the new value.
- [ ] Narrowing to a subtree lists only contributions of tasks held by people in that subtree, and the total stays the organization's.
- [ ] Through a faux session, a person without manager tools calls `fitness` with a `since` and gets the total, rate, contributions, and coverage; the package-load smoke test lists `fitness`.

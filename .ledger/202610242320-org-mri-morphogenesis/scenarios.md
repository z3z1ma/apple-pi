# Scenarios: what the fitness function does with real organizations

The operator asked (2026-10-25) to see the end effects as concrete storylines, and whether they expose gaps. Each scenario runs the spec's realized fitness (earned value − delay − compute) on toy numbers. Numbers are illustrative. Terms (realized fitness, cost of delay, obligation, completion, link, open wait) are defined in the Terms table of [spec.md](spec.md); "cold start" is the compute a new person spends learning the code before useful work.

**Verdict:** the function handles capacity, bottlenecks, urgency, and context reuse through delay and compute. It has three gaps: it does not say *why* work is delayed (queued, waiting, or in progress); idle people cost nothing; and quality is invisible, so review looks like pure cost and fixing your own bug earns value.

## 1. Twenty tickets, one engineer (understaffed)

An epic worth $2,000 split into 20 independent tickets of $100, each losing $10 per day. One engineer finishes 2 tickets a day at $5 of compute each.

| Organization | Days to finish | Delay | Compute | Fitness |
| --- | --- | --- | --- | --- |
| 1 engineer | 10 | about $1,050 | $100 | about +$850 |
| 4 engineers (3 new hires, about $30 each to learn the code) | 2.5 | about $280 | $100 + $90 | about +$1,530 |

Fitness shows the right answer: four engineers are far better. **But it shows it only as a large delay.** The breakdown cannot tell "18 tickets sit unassigned with nothing blocking them" (needs people) from "18 tickets wait on a decision" (needs a decision, not people). **Gap 1.**

## 2. Twenty engineers on the same epic (overstaffed)

Twenty hires at $30 each to learn the code is $600; the tickets touch shared files, so merge conflicts and coordination add, say, $200 of compute; delay falls to about $100.

| Organization | Delay | Compute | Fitness |
| --- | --- | --- | --- |
| 20 engineers | about $100 | $100 + $600 + $200 | about +$1,000 |

Fitness falls below the four-engineer case, as it should: the extra people pay in compute (cold start, coordination, conflicts) more than they save in delay. Spread-out context and communication overhead show up correctly, as compute.

## 3. Six engineers, two tickets (idle)

Four engineers have nothing to do. An idle Pi session makes no model calls, so it costs $0. **Fitness is unchanged by idle people.** That is true in dollars; the real costs of an idle person are a window on the operator's screen and machine memory, which fitness does not see. **Gap 2.**

## 4. One reviewer or two (quality)

A change worth $300. Three organizations:

| Organization | Compute | What happens | Fitness today |
| --- | --- | --- | --- |
| No review | $10 | Ships day 1. A defect is found on day 5; a fix task (valued $100 by its assigner) ships day 6 for $8 | +$300 + $100 − $18 − delay = **highest** |
| One reviewer | $10 + $6 | Defect caught before shipping; ships day 1.5 | +$300 − $16 − delay |
| Two reviewers | $10 + $12 | Same as one reviewer | lower again |

Today **review is pure cost, and an escaped defect earns extra value** through its fix task. An optimizer would remove review. Fitness has no quality axis because a defect in shipped work changes nothing in the accounting. **Gap 3.**

A fix that uses the existing currency: when work is found defective, record that the fix task `fixes` it. The defective task's value is taken back while it is broken and earned again when the fix completes; the fix earns no value of its own; its compute counts. In the table, "no review" then pays $300 for four days of broken work plus the fix compute, and a reviewer is worth it exactly when it catches enough defects to cover its compute. One reviewer against two then becomes a real trade-off that fitness can see over many changes, with no review-findings machinery.

## 5. Three tasks wait on one architect (decision bottleneck)

Three tasks at $20 per day each wait two days for one decision: $120 of delay, all of it on open `requires_decision` links to the same person. Fitness and the open waits show the bottleneck; the manager can delegate the decision or move the work. Works as intended.

## 6. A production incident (urgency and warm context)

A fix losing $500 per day. The person who built that code is at home; calling it in costs little and it starts within the hour. A new hire would take $40 and half a day to learn the code: $250 more delay. Fitness favours waking the warm person. Works as intended.

## 7. A research spike and a refactor (hard-to-value work)

A spike's value is the value of the decision it informs; a refactor's value is future savings. Both rely entirely on the assigner's estimate. Fitness is only as good as these estimates; the operator's corrections and value conservation are the only guard. Known limit, not a new gap.

## 8. Waiting on the operator

Two tasks wait a day each for the operator's answer: their delay counts; the interruption count rises. The operator's own time is unpriced (unmeasured). Works as the spec intends.

## Which organization the function favours, by kind of work

| Work | Organization fitness favours | Why, in fitness terms |
| --- | --- | --- |
| Many independent tickets | Several engineers, sized to the flow | Delay falls faster than cold-start compute rises |
| Tightly coupled change | One strong owner | Extra people add conflict and coordination compute |
| Risky change (migration, security) | Owner plus reviewer or challenger | With Gap 3 fixed: escaped defects cost value and fix compute |
| Incident | The warm person, called in | Small cold start, high cost of delay |
| Decisions piling on one person | Delegated decision authority | Waits on that person carry the delay |
| Quiet period | Fewer people awake | No fitness effect today (Gap 2) |

## Gaps to decide

1. **Delay by state.** Show each task's delay split into queued (unassigned and not waiting), waiting (an open wait link), and in progress. It is computed from existing facts. It turns "high delay" into "hire" against "decide" against "unblock".
2. **Idle people.** Keep idle at $0 (true in dollars; `send_home` stays a habit), or give an awake person a standing cost.
3. **Quality.** Add a recognized `fixes` relation: defective work loses its value until the fix completes, and a fix earns nothing of its own. Or leave quality out, and accept that fitness will push against review.
4. **Relation vocabulary (operator annotation).** Relation words come from one defined list, each with a one-line meaning; adding a relation is adding one line to that list, with no other code.

**Next step:** the operator decides these four gaps; the spec and the tickets are then amended to match before the tickets go back for sign-off.

## Decided (operator, 2026-10-25)

1. Delay is split by state: queued, waiting, in progress.
2. Idle people cost nothing.
3. Quality enters through a recognized `fixes` relation. The author added one refinement: the defective work also accrues its cost of delay while broken, because value taken back and returned would otherwise cancel out.
4. Relation words come from one package file; adding a relation is adding a line.

The spec and the tickets carry these decisions.

## Every role, not only implementers (operator, 2026-10-25)

The operator asked how fitness can judge reviewers, skeptics, architects, writers, and product people, whose value is mostly preventive or long-term. Decided ([Roles and expected fitness](decisions/24-roles-and-expected-fitness.md)): roles count only through how they change outcomes. The same function evaluates an observed history (realized) or a scenario of weighted hypothetical histories (expected). Example: a $300 change with a 30% chance of an unfixed defect and no reviewer has expected fitness $200; with a $6 reviewer cutting that chance to 10%, $254. The reviewer is worth $54 even in the outcomes where nothing went wrong. Findings are evidence for such scenarios, not credit, and a waste line shows prevented waste in realized fitness.

## Revised by the operator's review (2026-10-26)

The `fixes` rule in "Decided" item 3 is replaced: a defect no longer reverses the whole value of the work it touches (a $50 bug in a $10,000 feature must not cost $10,000). Any link can carry a dollar impact, `incurred` or `estimated`, and only incurred impacts are charged. "Waste" is renamed spend on dropped work: a fact, not a verdict. Time is counted in hours. See [spec.md](spec.md).

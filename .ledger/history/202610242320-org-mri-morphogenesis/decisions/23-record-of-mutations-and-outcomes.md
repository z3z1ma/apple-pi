Type: interrogation
Status: resolved
Blocked by: 21

## Question

Comparing fitness and improving estimates needs a memory of mutations: what was changed, the predicted change in fitness, and the observed change over the horizon. Decide where that lives with no new machinery: the runtime's existing manager-change and assignment history plus the links table, a fitness snapshot over time, the manager's message, or something else.

## Answer

The operator, 2026-10-24: a manager records each mutation's prediction as a link with the relation `predicts`, from the message that states the mutation to the organization (the spec drops "or subtree": fitness is global), with the predicted change in fitness and its horizon as the reason. The mutations themselves are already in the runtime's history (sessions, manager changes, assignments, incarnations, events). Realized fitness for any window is recomputed from the database by the evaluate primitive; there are no snapshots and no new table. Compare reads the prediction and evaluates the realized change over the same horizon. `predicts` is the first relation added to the brief's five.

Revised by the operator's review of the spec, 2026-10-25: a `predicts` link carries machine-readable data (time, horizon, predicted realized fitness over the horizon, optional estimated gain over no change, assumed valuations). It is compared with the fitness observed over the same window as a forecast error, never as a measured causal effect; a prediction whose valuation basis changed is not scored. See [spec.md](../spec.md).

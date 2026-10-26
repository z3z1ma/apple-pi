Type: interrogation
Status: resolved
Blocked by: 22, 23

## Question

How does fitness judge the many kinds of work in the role catalog (reviewers, skeptics, architects, writers, product people), whose value is mostly preventive, indirect, or long-term, so that the organization can decide to scale roles other than implementers?

## Answer

The operator, 2026-10-25, after the scenarios in [scenarios.md](../scenarios.md) and a long thread on the question (ambition B):

- Roles create value by changing the distribution of outcomes (defects, wasted work, delay, which work is chosen), not by producing credited deliverables. There is no per-role scoring and no role-specific credit.
- **One function, two inputs.** Fitness applies the same arithmetic U to an observed history (realized fitness) or to a scenario: a few weighted hypothetical histories under a candidate organization (expected fitness = the weighted sum of U). A manager compares organizations by evaluating their scenarios. The substrate never needs to know what a role is.
- A prediction is a recorded scenario; its forecast error against realized fitness is the check on optimistic scenarios.
- `finds` joins the relation vocabulary: a finding on a task, accepted or rejected by the task's owner. Accepted findings are evidence for estimating a role's effect in scenarios, never dollars in realized fitness, so prevented harm is not counted twice.
- The realized breakdown gains a waste line: compute and delay on tasks later cancelled or superseded, with compute per task attributed from focus history and marked as an estimate. Preventive roles show there as less waste.
- Organization base rates (escape rates with and without review, findings per reviewer) are left to managers for now; a view comes when managers keep computing the same thing.

Revised by the operator's review, 2026-10-26: realized and expected fitness are one pure evaluator over economic events fed by two adapters; scenarios are compared only on the same opportunities, valuations, and horizon; the evaluator scores forecasts and does not derive them. See [spec.md](../spec.md).

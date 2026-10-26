Type: interrogation
Status: resolved
Blocked by: 05

## Question

What form does a proposed organizational change take, and how is it applied? Options include a saved `pi_exec` program over the existing manager tools with a sign-off page, or a new runtime command. Decide preconditions, stale-proposal detection, partial failure and rollback, and how the prediction is stored for later evaluation.

## Answer

**Current answer:** a change is a mutation, a short composition of existing manager operations, chosen and applied by a manager and judged by its predicted and then measured change in fitness. No org patch, no saga, no cheapest-first rule. The text below records how the answer evolved; later revisions win.

Decided by the brief ([source.md](../source.md)); the operator directed on 2026-10-24 that the map follows it verbatim and that history data informs but does not gate. An organizational change is an `OrgPatch` (section 6): organization, `basedOnEventSeq` for stale detection, objective, diagnosis, expected effects, actions over existing runtime commands, preconditions, approval policy, rollback. It runs as a saga: check preconditions, apply each command with a stable idempotency key, verify observed state after each consequential step, stop or compensate when assumptions fail. No atomic whole-organization compare-and-swap. The prediction and the observed result are both stored (section 9, Layer C). Candidate interventions are searched cheapest first, with a margin and hysteresis; "no change justified" is a valid result.

Physical form: the brief fixes the concept, not the machinery. The operator ruled on 2026-10-24 that the implementation is aggressively minimal and verification work is deferred; the form is settled in [Minimal physical form](18-minimal-physical-form.md).

Revised: the operator, 2026-10-24, sees no need for an org patch; a change is judged by its effect on the fitness function. See [Hill-climbing loop](20-hill-climbing-loop.md).

Revised by the thesis ([thesis.md](../thesis.md)), 2026-10-24: a change is a mutation: a short composition of existing manager operations, judged by its estimated and then measured change in fitness. Cheapest-first is not a rule; mutation costs are part of fitness.

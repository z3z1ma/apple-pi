Type: interrogation
Status: resolved
Blocked by:

## Question

What is the smallest physical implementation that embodies the brief? The brief is true in intent; the operator ruled that complexity is rejected in every form and verification is deferred. This ticket absorbs the earlier questions on where the org layer runs and who diagnoses.

A starting sketch to react to, not settled:

1. **Facts.** One small runtime table of open waits: a person records that a task waits on a task, thread, or person, with a short reason; it clears when the target finishes or answers, or by hand. It covers `blocks` and `requires_decision`; the brief's other relations wait for a real need.
2. **MRI.** One read-only projection over the database (who waits on what and for how long, decision fan-in per person, who holds warm context for an area, reopen cost), returned by one diagnostic tool. Observed facts only.
3. **Diagnosis and proposal.** The manager itself, in its sweep, reads the projection, infers, and proposes. No Layer B component, no separate agent.
4. **Change.** A proposal is a message (to the operator, or in the team channel) that names the diagnosis, the actions, and the expected effect; the manager applies it with the existing tools. No patch engine or saga.
5. **Learning.** Episodes are derived on demand per task from the database; what a manager learns lives in its self, its notebook, and the charter.
6. **Teaching.** The manager charter carries the brief's principles: cheapest intervention first, restraint, reporting manager, task owner, and decision authority apart, shapes by coupling and risk.
7. **Operator surface.** `/org` shows the same projection; Agent World draws it later.

## Partial answers (operator, 2026-10-24)

- Diagnosis: the manager itself, in its sweep, with one diagnostic tool; the charter tells it to read it, infer, and propose. No new component, role, or agent.
- Change form: the manager states the diagnosis, the actions, and the expected effect in a message, then applies them with the existing manager tools. No patch object.

## Answer

**Current answer:** one generic links table (the brief's five relations plus `predicts`), and the four primitives observe, evaluate, mutate, compare; the manager searches in its sweep; `/org` for the operator. Items 2 to 5 of the answer below are recast by the revision at its end. The text below records how the answer evolved; later revisions win.

The operator, 2026-10-24: keep the brief's richness, make the implementation simple, and put no machinery around it. Cut machinery, never concepts.

1. **Facts: the full WorkLink, as one generic table.** One runtime table of links between existing entities (task, session, thread, commit, PR, file, check run), each with a relation, a short reason or evidence reference, who recorded it, whether it was asserted or inferred, when it was created, and when it was resolved. The relation set starts with the brief's five (`blocks`, `requires_decision`, `produced`, `verifies`, `supersedes`) and grows by adding a word, not code. People record and resolve links through one plain tool; a waiting link resolves when its target finishes or answers. Waiting is the first use the charter teaches; the other relations are there from day one.
2. **MRI:** one read-only projection over the database and the links (waiting and for how long, decision fan-in, warm context by area, reopen cost), returned by one diagnostic tool. Findings are observed, inferred, or proposed.
3. **Diagnosis and proposal:** the manager itself in its sweep, with that tool. No separate component, role, or agent.
4. **Change:** the manager states the diagnosis, the actions, and the expected effect in a message, applies them with the existing manager tools, and reports ([Autonomy ladder](05-autonomy-ladder.md)).
5. **Learning:** episodes are derived on demand per completed task from the database and the links; what a manager learns lives in its self, its notebook, and the charter.
6. **Teaching:** the manager charter carries the brief's principles: cheapest intervention first, restraint, reporting manager, task owner, and decision authority apart, shapes by coupling and risk, and when to record a link.
7. **Operator surface:** `/org` shows the same projection; Agent World and tmux draw it later.

Revised by the thesis ([thesis.md](../thesis.md)), 2026-10-24: items 2 to 5 are recast as the four primitives: observe (existing state and links), evaluate (one function returning the scalar fitness and its components), mutate (existing manager tools), compare (estimated or measured differences in fitness). The links table stays.

Revised by the operator's review of the spec, 2026-10-25: links have generic storage plus a few recognized meanings (`blocks`, `requires_decision`, `predicts`), an optional JSON data field, and resolve on their own only when a target task completes. See [spec.md](../spec.md).

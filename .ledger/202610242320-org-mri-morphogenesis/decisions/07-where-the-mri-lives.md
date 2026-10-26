Type: interrogation
Status: resolved
Blocked by: 01, 06

## Question

Where does the MRI live and how is it computed? Decide the component boundary (beside `components/session-state/`, inside the runtime, or a reader like the views), on-demand query versus incremental projection, and how each finding carries its status (observed, inferred, proposed) and its evidence.

## Answer

**Current answer:** the MRI is the introspective surface of fitness evaluation: the evaluate primitive's scalar and components, explained by the database and the links. No separate diagnostic subsystem. The text below records how the answer evolved; later revisions win.

Decided by the brief ([source.md](../source.md)); the operator directed on 2026-10-24 that the map follows it verbatim and that history data informs but does not gate. Layer A is a module adjacent to `components/session-state` that reads the event stream and incrementally, deterministically materializes organizational measurements; Layer B is a separate diagnosis and planning component that may invoke an agent for ambiguous cases and produces structured diagnostic records with evidence, confidence, affected tasks, and remedies; every finding is observed, inferred, or proposed (sections 4, 9). The MRI works with morphogenesis disabled. The layers are concepts, not components: [Minimal physical form](18-minimal-physical-form.md) settles them as one links table, one diagnostic projection, and the manager diagnosing in its sweep.

Physical form: the brief fixes the concept, not the machinery. The operator ruled on 2026-10-24 that the implementation is aggressively minimal and verification work is deferred; the form is settled in [Minimal physical form](18-minimal-physical-form.md).

Revised by the thesis ([thesis.md](../thesis.md)), 2026-10-24: the MRI is the introspective surface of fitness evaluation (components, contributing relationships, history, sensitivity to mutations), not a diagnostic subsystem with its own catalogue of organizational illnesses. The seven signals are explanations of why fitness moves, not special cases in code.

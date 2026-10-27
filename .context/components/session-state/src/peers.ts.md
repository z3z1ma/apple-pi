## symbol:installPeers

The bridge installs peer discovery in every root session, not only managers. Restore activation at session start and before a turn while preserving other active tools: Pi can restore a transcript's older tool set on resume and tree navigation.
Coupled: components/session-state/src/bridge.ts, components/session-state/src/coordinator.ts
Verify: components/session-state/tests/coordinator.test.ts, components/session-state/tests/peers.test.ts

## symbol:readDirectory

The person and private pair share the same compact projection. The pair binds the main person's identity, since its private SDK session has no organization row. Current membership includes people at home; legacy retired rows stay outside this discovery surface without deleting retained facts.

Availability means no held assignments, not idle execution. Finished counts and history use workOf.record: finished assignments, not unassignments or broad participation. Work/backlog discovery belongs to org_work; directory has no manager-only backlog branch.
Coupled: components/organization/src/directory.ts, components/session-state/src/work-read.ts, components/pair-programmer/src/second-opinion.ts
Verify: components/session-state/tests/peers.test.ts, components/session-state/tests/work.test.ts, components/pair-programmer/tests/second-opinion.test.ts

## symbol:directoryView

Compactness applies to the whole response, including structured details. Default overview contains counts, filtered/paged discovery contains compact person rows, and a requested person profile contains current task references. Finished outcomes require an explicit person history page; souls stay outside every directory result. Increasing existing outcome/soul text must not change overview/profile payloads.
Why: one-line prose formerly concealed every person's full outcomes and souls in details, and even a single-person record could grow without bound.

Native and pair share schema, description and projection. Single-person selectors (person/team/subtree) accept the caller too, prefer exact IDs and reject ambiguous names; name substring discovery can return multiple identified matches. A view derives counts/selection/profile/history from one organization read. People sort by exact opaque ID order, not locale collation; history retains the work reader's descending end-time/assignment-ID order. Limits/offsets are explicitly requested safe integers, with totals and nextOffset. Offset pages describe the current read, not an immutable cursor across concurrent membership/history changes.
Coupled: components/pair-programmer/src/second-opinion.ts, components/session-state/src/work-read.ts
Verify: components/session-state/tests/peers.test.ts, components/session-state/tests/work.test.ts, components/pair-programmer/tests/second-opinion.test.ts

## file

Forward migrations preserve recorded provenance. The link-origin migration leaves existing links' organization null rather than deriving a historical origin from today's tree; the links reader uses surviving evidence for legacy resolution and explicitly reports unknown ownership when none remains. New links write their organization with their endpoints and recorder in one insert.
Why: a discarded temporary peer can leave artifact-only links with no surviving ownership evidence. Guessing an origin during migration would turn missing history into authorization.
Migration tests reconstruct a particular historical physical schema and pin its actual user_version (24 before task lifecycle columns, 26 before link origins), rather than subtracting from the latest version.
Why: adding a migration otherwise advances the fixture's claimed version without changing its tables, silently skipping the backfill the test intends to exercise.
Coupled: components/session-state/src/links.ts
Verify: components/session-state/tests/links.test.ts, components/session-state/tests/work.test.ts

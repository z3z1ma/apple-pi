## file

This reduced migration fixture supplies the physical version29 event table, with known cost, membership and unrelated tool payloads. It checks that the public migrator preserves those records and sequence and remains safe when invoked again. Other old-schema fixtures remove the later type index before declaring their earlier physical version.
Why: advancing only user_version on a latest-schema database would test a contradictory physical state; an index migration must retain unrelated payloads, not silently perform departure scrubbing.

The test does not pin SQLite's optimizer description or impose an unchosen runtime limit. The separate disposable whole-database upgrade/query trial establishes the measured access-path effect, not this reduced unit fixture.
Why: a valid faster query plan can differ by SQLite version or data distribution while the retained-history contract stays unchanged.

Coupled: components/session-state/src/schema.ts, components/session-state/tests/peer-history.test.ts, components/session-state/tests/links.test.ts, components/session-state/tests/participation.test.ts, components/session-state/tests/work.test.ts
Verify: components/session-state/tests/event-index.test.ts

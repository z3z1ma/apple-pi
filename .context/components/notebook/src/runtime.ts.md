## file

This runtime remains the lifetime guard for notebook writes and the cache for trust-sensitive configuration; it no longer schedules compaction. Its disposed flag is consumed by notebook maintenance when admitting updates and executing `update_notebook`.
Why: removing the idle-compaction timer does not end the notebook's lifetime obligations. A late pair update must still be refused after root shutdown, and a change in project trust must cause configuration to be resolved again rather than reuse the previous authority.
Coupled: components/notebook/src/notebook-maintenance.ts, components/pair-programmer/src/extension.ts
Verify: components/notebook/tests/config.test.ts

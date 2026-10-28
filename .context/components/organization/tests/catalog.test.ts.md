## file

Check every concrete recommendation at the role's shared effort against the minimum workload band, rather than snapshotting whole ordered arrays or the current catalog size. The technical writer's Terra preference is an explicit policy choice; other valid reorderings within a band need not break the test.
Why: a safe first choice can hide an undersized fallback, while full-array snapshots make coherent catalog growth or preference changes look like regressions. The public catalog and its configuration are the consumer surface here, not live provider availability.
Coupled: tests/helpers/model-sizing.ts, docs/model-profiles.md, components/organization/src/roles.ts
Verify: components/organization/tests/catalog.test.ts

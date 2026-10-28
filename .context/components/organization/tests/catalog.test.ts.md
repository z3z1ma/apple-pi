## file

Check every concrete model/effort recommendation against its workload band, rather than snapshotting whole ordered arrays or the current catalog size. The technical writer's Terra preference is an explicit policy choice; other valid reorderings within a band need not break the test.
Why: a safe first choice can hide a mis-sized fallback, while full-array snapshots make coherent catalog growth or preference changes look like regressions. The public catalog and its configuration are the consumer surface here, not live provider availability.
Coupled: tests/helpers/model-sizing.ts, docs/model-profiles.md, components/organization/src/roles.ts
Verify: components/organization/tests/catalog.test.ts

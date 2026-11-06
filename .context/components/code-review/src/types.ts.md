## file

workers is staffing input retained with the request, not captured code/intent identity; artifactDigest deliberately ignores it. Admission resolves names to lasting person IDs and fresh reruns copy that pool. The ordinary absent/empty request still uses temps.
Coupled: components/session-state/src/review-jobs.ts, components/code-review/src/capture.ts
Verify: components/session-state/tests/review-workers.test.ts

`instructions.duplicates` is absent on captures made before parallel validation. `index` is the captured tree, or an entry list on manifests from before Git-native capture. `label` is display only, outside the digest, and absent on older captures. `branch` is null when detached. `subject` and `commits` apply to commit, range, and branch targets.
Why: older artifacts must stay readable without inventing fields the digest did not include.
Verify: components/code-review/tests/capture.test.ts

## file

`instructions.duplicates` is absent on captures made before parallel validation. `index` is the captured tree, or an entry list on manifests from before Git-native capture. `label` is display only, outside the digest, and absent on older captures. `branch` is null when detached. `subject` and `commits` apply to commit, range, and branch targets.
Why: older artifacts must stay readable without inventing fields the digest did not include.
Verify: components/code-review/tests/capture.test.ts

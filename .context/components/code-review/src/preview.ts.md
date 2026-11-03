## file

Preview captures identity in a temporary directory and returns it without keeping a second source store or starting model work.
Why: a preview that retained objects or launched reviewers would duplicate capture and spend a review the operator did not ask for.
Coupled: components/code-review/src/capture.ts
Verify: components/code-review/tests/preview.test.ts

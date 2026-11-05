## file

Every pass, integration included, runs in parallel and never sees another pass's report. The planner prompt says so and forbids questions that ask a pass to reconcile, compare or challenge other reports; the merge links duplicates afterwards. Questions should ask only for evidence a reviewer can produce on this machine, and the inspection prompt separates `unavailable` (a live service, hardware, credentials or a missing tool) from `incomplete` (could be settled here but was not).
Why: 23 of 26 recorded plans asked the integration pass to reconcile the focused reports it cannot see, and that contradiction alone made 7 reviews incomplete. Treating unavailable evidence as incomplete made another 4 reviews incomplete when nothing more was possible without a person.

Do not tell an inspector to "cover the repository standards and captured intent" as if it were a question: models added it as an extra coverage entry, which failed whole reviews. Apply standards and intent inside the planned answers.

These strings are captured into each artifact's configuration, so a resumed old review keeps the prompts it was captured with.
Coupled: components/code-review/src/contracts.ts, components/code-review/src/policy.ts, components/session-state/src/review-jobs.ts
Verify: components/session-state/tests/review-queue.test.ts, components/code-review/tests/capture.test.ts

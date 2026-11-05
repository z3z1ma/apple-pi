## file

The runtime writes decisions inside its existing command transaction. A decision ID is its command ID: exact mutation replay retains the original effect rather than appending a second response. Source verification happens before the transaction; the transaction rechecks the settled state, artifact, revision and owner before changing the assessment. Finding responses advance the assessment revision. Operator approval records bind that revision without themselves changing it; later responses invalidate the match while retaining the signed record.

Fix verification records the actual question evidence and immutable attempt/validator references, rather than resolving a mutable review ID later. It is the responder's explicit judgment about that evidence, not automatic semantic proof. A later fix still leaves the original snapshot's allegation visible as a sign-off limit. A substantive owner response can also disagree with model rejection; model rejection must not hide an explicitly accepted risk or claimed fix.

A completed review's reason is a limit too: the runtime records non-blocking execution notes there, such as duplicate linking that failed twice.

The operator alone signs off. Approval with missing coverage, missing intent, reported risks or other displayed limitations requires explicit acknowledgment. matchesAssessment refers to the recorded artifact and result revision, not live-checkout freshness or proof that retained files remain available forever. The browser must use the same limit projection and repeat runtime-bound verification at submission.

Coupled: components/session-state/src/review-jobs.ts, components/session-state/src/review-read.ts, components/code-review/src/decisions.ts, components/session-state/src/schema.ts
Verify: components/session-state/tests/review-queue.test.ts

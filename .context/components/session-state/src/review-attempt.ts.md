## file

This is an ordinary program-peer client owned by the runtime, not another model runner. Persist attempt, program, person and command identities before launch; the runtime derives a review scope from that stored program ID. The scope's generation, plan revision, owner, person and role must still match at launch. Ordinary Pi Exec program scopes retain their original behavior.

Save a terminal turn's structured output, observed usage and failure before rejecting cancellation or beginning cleanup. Keep the raw result distinct from validated output, and keep both distinct from completed cleanup. A malformed report can come from a completed model turn that incurred usage. A closed socket cannot prove disposal; scope disappearance under the existing guarded lifecycle does. Preserve partial results when cleanup fails.

A resumed job can reuse a completed, cleaned attempt only for the same job, plan revision, pass and exact input identity; callers additionally reject incomplete coverage. A new attempt gets new person/program/command identities. Retaining an old result is not permission for an obsolete attempt to update the current job. Exactly-once paid execution is not promised across lost results.

Role policy is recorded before launch; the actual model/thinking observed at turn start is recorded separately. The normal role resolver chooses the mind and pool member. This client checks that the selected model belongs to the recorded policy instead of silently accepting a fallback; it does not select another model or advance profile-pool counters. Usage covers the observed correlated turn, not an invented total for every internal model the ordinary peer environment might run. The peer's native transcript remains its transcript owner.

Coupled: components/session-state/src/review-jobs.ts, components/session-state/src/runtime.ts, components/session-state/src/program-client.ts, components/session-state/src/schema.ts, components/organization/src/session-role.ts
Verify: components/session-state/tests/review-queue.test.ts, components/session-state/tests/program-peers.test.ts

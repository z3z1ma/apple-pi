## file

Role consumers may fall back to their declared exact models only when the global file or requested mapping is absent. Optional loading suppresses ENOENT alone; malformed configured profiles and pools with no eligible candidates remain fatal. Existing intern, pair, and judge consumers keep required loading.
Why: treating a configured profile error as absence silently replaces the operator's inference policy with a different model or thinking level.

Candidate resolution and selection are separate so a role can finish eligibility checks before advancing the shared round-robin counter. Registry registration alone is insufficient when configured-auth checks are available; the chosen candidate retains its own thinking level.
Why: a person selects a mind once and persists it; advancing selection before eligibility is settled can consume turns for models that cannot serve the person.

Coupled: components/organization/src/roles.ts, components/organization/src/session-role.ts
Verify: components/shared/tests/model-profiles.test.ts, components/shared/tests/profile-request.test.ts

## file

Role consumers may fall back to their declared exact models only when the global file or requested mapping is absent. Optional loading suppresses ENOENT alone; malformed configured profiles and pools with no eligible candidates remain fatal. Existing intern, pair, and judge consumers keep required loading.
Why: treating a configured profile error as absence silently replaces the operator's inference policy with a different model or thinking level.

Candidate resolution and selection are separate so a role can finish eligibility checks before advancing the shared round-robin counter. Registry registration alone is insufficient when configured-auth checks are available; the chosen candidate retains its own thinking level.
Why: a person selects a mind once and persists it; advancing selection before eligibility is settled can consume turns for models that cannot serve the person.

The entire configured catalog is validated before a requested profile is selected. Changes to supported names require coordinated updates to both starting policies and the live user-global policy.
Why: an obsolete entry can prevent unrelated profiles from resolving; removing only its direct consumers is insufficient.

Validate extension-provider availability against a registry with those extensions loaded, or inspect the installed provider's model metadata. A bare `ModelRuntime.create()` omits extension providers such as Antigravity even when the CLI lists them. Keep portable policy tests independent of the operator's model cache; registration and configured auth establish eligibility, not live quota or provider health.
Why: an incomplete registry can falsely classify a usable policy as unavailable, while metadata alone cannot establish that requests will succeed.

Coupled: components/organization/src/roles.ts, components/organization/src/session-role.ts, model-profiles.openai.json, model-profiles.anthropic.json
Verify: components/shared/tests/model-profiles.test.ts, components/shared/tests/profile-request.test.ts

## file

This is a provider-specific starting policy copied into the user-global authority, not runtime configuration read from the checkout. Its profile names track the shared catalog; model/effort choices track the operator sizing policy documented in the model profiles guide.
Why: the loader validates every configured entry, so a retired name here can prevent unrelated profiles from resolving after a user copies the example. Model-relative effort also makes a numeric-level-only comparison misleading.
Coupled: components/shared/src/model-profiles.ts, docs/model-profiles.md, docs/setup.md, tests/helpers/model-sizing.ts
Verify: components/shared/tests/model-profile-examples.test.ts

## file

This starting policy covers Anthropic inference independently of the operator's current quota. The live user-global policy may intentionally omit Anthropic while this example remains complete. Profile names track the shared catalog and per-model effort follows the documented sizing policy.
Why: copying temporary quota constraints into the reusable provider example would remove its purpose; leaving a retired profile name would make the strict loader reject the whole copied policy.
Coupled: components/shared/src/model-profiles.ts, docs/model-profiles.md, docs/setup.md, tests/helpers/model-sizing.ts
Verify: components/shared/tests/model-profile-examples.test.ts

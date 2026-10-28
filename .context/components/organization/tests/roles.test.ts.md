## file

Profile-priority and resume scenarios need distinct profile/default model IDs, reasoning-capable fixtures, and registry lookups that honor the requested identity. Observe the resulting session model, effort, and completed or aborted response across lifecycle events rather than the number of custom entries appended.
Why: a registry fake that returns one model for every identity can let a broken profile/default selection pass; counting transcript writes couples persistence tests to serialization without proving that the person's mind survives a reopen.
Coupled: components/organization/src/session-role.ts, tests/helpers/faux-session.ts
Verify: components/organization/tests/roles.test.ts

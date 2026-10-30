## file

Profile-priority and resume scenarios need distinct profile/default model IDs, reasoning-capable fixtures, and registry lookups that honor the requested identity. Observe the resulting session model, effort, and completed or aborted response across lifecycle events rather than the number of custom entries appended.
Why: a registry fake that returns one model for every identity can let a broken profile/default selection pass; counting transcript writes couples persistence tests to serialization without proving that the person's mind survives a reopen.
Catalog flags, model-visible delegation, and actual writing are separate capability claims. The four new management jobs keep independent expected names, and their writing cases execute native write/edit calls and inspect the resulting artifact after the real role lifecycle runs.
Why: parsing `writes: true` can pass while role activation removes a tool; a scripted successful assistant answer would also hide that failure. The file result checks capability execution, not whether a real model understands the management job.
Coupled: components/organization/src/session-role.ts, tests/helpers/faux-session.ts, roles/product-manager.md, roles/engineering-manager.md, roles/service-owner.md, roles/research-lead.md
Verify: components/organization/tests/roles.test.ts

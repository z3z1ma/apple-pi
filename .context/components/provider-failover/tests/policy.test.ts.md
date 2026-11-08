## file

Check rotation preservation through normal startup selection: first consume a configured round-robin choice, resolve failover candidates, then assert the next startup choice. Keep all settings and registry facts temporary and synthetic.
Why: absence of a particular SQLite file only tested a storage implementation and an unused counter. An operator's existing pool already has rotation state; recovery must leave the next healthy startup choice unchanged regardless of its storage.

A coordination-policy assertion must include actual candidates, not only every(name === coordination).
Why: every on an empty list succeeds and would conceal recovery having no eligible destinations.

Coupled: components/provider-failover/src/policy.ts, components/shared/src/model-profiles.ts
Verify: components/provider-failover/tests/policy.test.ts

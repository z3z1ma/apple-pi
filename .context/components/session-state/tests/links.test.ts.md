## file

The link-origin upgrade case removes its organization column and uses historical-schema.ts for later physical differences before declaring version26. The original recorder survives and organization remains unknown; fixture repair must not manufacture provenance merely to pass a newer migration.
Coupled: components/session-state/tests/historical-schema.ts, components/session-state/src/schema.ts
Verify: components/session-state/tests/links.test.ts

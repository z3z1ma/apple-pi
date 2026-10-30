# Implementation evidence

The operator authorized personal implementation, extension beyond the first set, and incremental commits. Root authors and integrates the changes; any live participants are controlled exercise subjects, not delegated builders or reviewers.

## Help and decide

Added model-selectable `peer-consultation` and `decision-review`, a writing/managing `product-manager`, and shared process operating conventions under the existing handbook. Updated authoring policy, the real loader inventory, role capability cases, human catalog and provenance. Existing explicit-entry workflows and advisory role postures are unchanged.

Checks:

- `npm run test:loader`: all extension entrypoints loaded, skills discovered with intended invocation policy, new relative references resolve. Log: `/tmp/process-skills-increment1-loader.log`.
- `npx vitest run components/organization/tests/roles.test.ts --maxWorkers=1`: 43 tests passed. Includes product-manager capability/schema activation and unchanged advisory metadata. Log: `/tmp/process-skills-increment1-roles.log`.
- `npm pack --dry-run --json`: inspected and confirmed both new skills, the shared reference and product-manager are included. `/tmp/process-skills-increment1-pack.json`.
- Scoped Biome checks and `git diff --check`: passed.
- Provenance insertion preserved all pre-existing THIRD_PARTY_NOTICES.md bytes, including embedded mixed-line-ending licenses.

These checks establish packaging, discovery and role capability integration. Real-model selection and process execution are still pending; no effectiveness claim is made from the scripted role tests.

Committed: `bf8c36e7`.

## Deliver, transfer, recover and learn

Added `tiger-team`, `handoff`, `incident-response`, `operating-review` and `retrospective`, plus writing/managing `engineering-manager` and `service-owner` roles. All seven initial skills are now registered, documented and packaged. These concise prose changes share the same integration checks, so the remaining first-set increments land together rather than repeat a commit gate for each document.

- Loader passed: `/tmp/process-skills-core-loader.log`.
- Focused role catalog/capability selection: 10 passed, 35 deliberately skipped; `/tmp/process-skills-core-roles.log`.
- Package dry run confirmed all five added skills and both roles; `/tmp/process-skills-core-pack.json`.
- Scoped Biome and whitespace checks passed.

Live process exercises and model-selection evidence remain pending.

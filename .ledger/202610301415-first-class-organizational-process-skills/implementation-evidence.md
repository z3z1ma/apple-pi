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

Committed: `a4c877d5`.

## Wider portfolio and selection

Added eight distinct processes: pre-mortem, prioritization, release readiness, discovery workshop, onboarding, failure exercise, due diligence and experiment cycle. Added research-lead for sustained multi-person inquiry; a bounded lookup still belongs with one researcher. Due diligence remains its own selectable inquiry because its result is evidence of inherited obligations and exit options, not a decision board; decision-review retains the choice. Imagined risks, injected faults, problem framing and observed experiments retain different outputs rather than share a vague workshop skill.

- Loader passed: `/tmp/process-skills-wide-loader.log`.
- Focused role catalog/capability selection: 11 passed, 35 deliberately skipped; `/tmp/process-skills-wide-roles.log`.
- Package dry run confirmed the eight skills and research-lead; `/tmp/process-skills-wide-pack.json`.
- Scoped Biome and whitespace checks passed.
- `selection-check.mjs` used the configured live `openai/gpt-6.1-sol` model with the actual packaged model-visible names/descriptions, fresh independent contexts, no skill bodies and no tools. **18/18** cases selected the intended entry, including a no-process case and code-review/diagnosing-bugs controls. Raw requests, answers and recorded model cost ($0.0498724) are in `selection-results.json`. No runtime people, tasks or production effects were created by this metadata check.

Wider portfolio committed: `7ed2f649`.

This is one model and an explicit synthetic classification request, not autonomous process adoption during real work. It does not establish actual collaboration, role effectiveness or business benefit. Native consultation/decision exercises subsequently ran as described below. The remaining processes still have no live-execution proof.

## Native exchanges and final verification

`exercises.md` records the actual consultation and decision exchanges, source thread/message references, isolated toy programs/results, participant closeouts and a per-process coverage table. Root authored and executed both probes. Niamh and Riku were subjects, not builders or reviewers. Both finished their assignments and were verified idle and unassigned before going home.

One observed procedural failure changed the handbook: root archived the consultation before Niamh's reflection reply arrived. The shared convention now collects the closing exchange before archiving; the later decision discussion waited for both closeouts. A separate repeated pre-execution Pi Exec type-checker failure prevented a composed archive call; root verified the thread was still open and used the native tool directly. No runtime workaround was added.

Final checks:

- Loader passed after the closing-order change, including references in the shared convention: `/tmp/process-skills-final-loader.log`.
- Full relevant role test file: **46 passed**, serialized with `--maxWorkers=1`: `/tmp/process-skills-final-roles.log`.
- `npm run typecheck`: both Node and Web passed; `/tmp/process-skills-final-types.log`.
- Final package dry run: **2,738 files**, all 15 new skills, four roles and shared reference included; exercise artifacts excluded. `/tmp/process-skills-final-pack.json`.
- Both toy programs passed again after scoped formatting. Their outputs remain in the bundle.
- Scoped Biome and whitespace checks passed. Changed Markdown text integrity, local targets and heading references passed.

No full repository suite or installed-tarball startup was run. The running root session has not reloaded resources; existing sessions need `/reload`, while fresh sessions use the existing package loader. No daemon or Workplace restart, new runtime store, tool or workflow engine was introduced. Existing unrelated knowledge-file changes were left intact.

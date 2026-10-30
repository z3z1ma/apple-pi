# Implementation evidence

## Acceptance gap

The approved proposal requires package checks, selection/cold reading and a small live exercise for every adopted skill before delivery. The implementation task later substituted an exercise-or-reported-limit criterion without a recorded operator waiver. Reporting limits is necessary but does not meet that original requirement.

Source implementation is shipped. Final acceptance remains incomplete: the live metadata selection covered all 15 additions, but native exercises covered only consultation and decision review, and the broader body/role comprehension checks remain unperformed. The archival completion claim was premature against the approved plan. The operator must either retain the original validation requirement or explicitly accept a narrower completion scope; existing evidence remains valid only for what it actually checked.

The operator authorized personal implementation, extension beyond the first set, and incremental commits. Root authors and integrates the changes; any live participants are controlled exercise subjects, not delegated builders or reviewers.

## Help and decide

Added model-selectable `peer-consultation` and `decision-review`, a writing/managing `product-manager`, and shared process operating conventions under the existing handbook. Updated authoring policy, the real loader inventory, role capability cases, human catalog and provenance. Existing explicit-entry workflows and advisory role postures are unchanged.

Checks:

- `npm run test:loader`: all extension entrypoints loaded, skills discovered with intended invocation policy, new relative references resolve. Log: `/tmp/process-skills-increment1-loader.log`.
- `npx vitest run components/organization/tests/roles.test.ts --maxWorkers=1`: 43 tests passed. Includes product-manager capability/schema activation and unchanged advisory metadata. Log: `/tmp/process-skills-increment1-roles.log`.
- `npm pack --dry-run --json`: inspected and confirmed both new skills, the shared reference and product-manager are included. `/tmp/process-skills-increment1-pack.json`.
- Scoped Biome checks and `git diff --check`: passed.
- Provenance insertion preserved all pre-existing THIRD_PARTY_NOTICES.md bytes, including embedded mixed-line-ending licenses.

These checks established packaging, discovery and role capability integration. At this increment, real-model selection and process execution were still pending; the later sections record them. No effectiveness claim is made from the scripted role tests.

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

After archive, local-reference validation covered 32 Markdown files, 114 local links and 18 heading targets; both toy programs also ran successfully from the history path. The first archive whitespace check caught an extra terminal blank line left in the live index when its last row moved. Root removed that blank line before the final archive commit; archiving alone is not a whitespace check.

No full repository suite or installed-tarball startup was run. The running root session has not reloaded resources; existing sessions need `/reload`, while fresh sessions use the existing package loader. No daemon or Workplace restart, new runtime store, tool or workflow engine was introduced. Existing unrelated knowledge-file changes were left intact.

## Maintainer review follow-up

The added catalog names, invocation-policy expectations, relative-reference checks and advisory-role constraints protect the stated public contract, so they were retained. Four additional SDK cases now execute native write and edit calls for the new managing jobs and inspect the resulting artifact; metadata flags alone did not prove that writing worked after role activation. The relevant role file now has **50 passing tests**, with one worker. Node/Web typechecks and the loader passed again. Logs: `/tmp/process-handbook-reflection-roles.log`, `/tmp/process-handbook-reflection-types.log`, `/tmp/process-handbook-reflection-loader.log`.

The selection script's existing cleanup guard now includes setup. An isolated missing-settings failure reproduced one leaked scratch directory before the change and zero after it, without constructing the model runtime or making a model request. Its live classification loop was not rerun; the original paid result remains historical evidence. Both unchanged toy probes were rerun from disposable copies and reproduced their saved reports without rewriting those reports. They remain separate explicit fixtures rather than acquiring a shared cache abstraction.

The decision-review chair sentence and chronological evidence wording were clarified. New context files record the three scripts' experimental/provenance limits, and the two existing test contexts now distinguish catalog flags from executable capabilities. Context lint passed over 326 files.

**Open validation-scope question for the operator:** the original proposal required all three evaluation layers before each skill's delivery, while the implementation task accepts a live exercise or a reported validation limit. Does the original per-skill live-exercise gate still apply, or are the explicitly reported limits accepted? This review leaves those policies unchanged and does not treat selection checks as the missing live trials.

## Post-completion reflection follow-up

Reflection added four native write/edit execution cases for the new management roles, corrected setup-failure cleanup in the selection script, and clarified the decision-owner sentence. Root inspected the source and test diffs before retaining them. The capability tests inspect actual file contents after the role lifecycle, rather than treating metadata or a scripted final answer as proof of writing.

- Relevant role suite: **50 passed** with `--maxWorkers=1`; `/tmp/process-handbook-reflection-roles.log`.
- Node/Web typechecks and loader passed again: `/tmp/process-handbook-reflection-types.log`, `/tmp/process-handbook-reflection-loader.log`.
- The isolated missing-settings probe failed before model-runtime construction and left **zero scratch directories**. Its repeatable form is retained as `selection-cleanup-check.mjs`. The setup cleanup is now inside the same try/finally as provider calls.
- The original paid selection run and `selection-results.json` were preserved; this follow-up made no new selection or effectiveness claim.

The retained cleanup probe was rerun successfully; scoped Biome and whitespace checks passed. Context lint passed for 326 files. Context notes preserve the distinct packaging, capability, toy-exercise and selection boundaries. An optional Verify-line addition to the selection context file was refused by the context gate even after a fresh direct read; it was left out rather than bypassed. The cause is unresolved and the check remains linked here. The four pre-existing unrelated knowledge-file changes remain outside this follow-up.

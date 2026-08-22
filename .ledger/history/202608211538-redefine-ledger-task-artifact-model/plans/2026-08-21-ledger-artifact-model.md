Status: complete
Created: 2026-08-21
Updated: 2026-08-21

# Ledger Artifact Model Implementation Plan

> **For executors:** REQUIRED SUB-SKILL: Use work-item-orchestration (recommended) or plan-execution to implement this plan Work-Item by Work-Item. This plan owns the canonical `WI-###` execution state.

**Goal:** Make every newly created Ledger bundle, injected contract, durable document, lifecycle skill, and executable check teach the approved intent-first artifact ontology.

**Architecture:** Change the scaffold producer first, then align the injected runtime contract and durable repository guidance, then update the packaged lifecycle procedures that consume that contract. Keep archival mechanics unchanged, use existing files rather than adding a schema or compatibility layer, and verify each boundary with behavioral tests or focused content searches before the final package checks.

**Tech Stack:** TypeScript ESM, Node.js filesystem APIs, Typebox-backed Pi tools, Vitest, Markdown Agent Skills, Biome, TypeScript.

**Spec:** `.ledger/202608211538-redefine-ledger-task-artifact-model/specs/ledger-artifact-model.md`

## Global Constraints

- Preserve one current artifact model; do not add migration, compatibility, schema-version, old/new, or fallback paths.
- Do not modify `.ledger/history/**` or reinterpret archived bundles.
- Preserve unrelated existing `.ledger` work and the current index/archive mechanics.
- `task.md` owns intent and acceptance, plans own execution progress, `evidence/` owns validation observations, and `retrospective.md` owns learning and concrete improvement.
- Research owns inquiry and synthesis; evidence owns discrete validation observations. Link rather than duplicate an observation.
- Task-local `knowledge/` and `skills/` are not part of the current bundle model.
- Evidence records observation and limits; it does not become semantic authority or progress state.
- Do not add a dependency, parser, catalog, migration command, verification-only fixture, or unused metadata.

## File and Ownership Map

- `extensions/ledger.ts` is the only bundle scaffold producer. It creates the supported directories and root files; `ledger_close` remains an archival primitive only.
- `tests/ledger-add.test.ts` exercises the production scaffold. `tests/ledger-close.test.ts` is a non-goal regression guard and should not need semantic changes.
- `components/shared/src/ledger-system-prompt.ts` is the injected contract seen by root sessions, children, and workers.
- `tests/ledger-prompt-integration.test.ts` verifies injection/idempotence and will assert the new artifact boundaries through the production prompt builder.
- `docs/ledger.md` is the durable user/maintainer contract; `AGENTS.md` is the repository routing map; `README.md` is the public catalog.
- `skills/task-shaping/`, `skills/implementation-planning/`, and their review templates own shaping and planning destinations.
- `skills/plan-execution/`, `skills/work-item-orchestration/`, `skills/parallel-orchestration/`, `skills/workspace-isolation/`, `skills/test-first-development/`, `skills/root-cause-debugging/`, and `skills/ralph/` own execution and investigation destinations.
- `skills/review-commissioning/`, `skills/review-reconciliation/`, `skills/completion-verification/`, `skills/task-closure/`, and `skills/skill-authoring/` own review, closure, retrospective, and durable-improvement routing.
- `package.json` already publishes `extensions/`, `components/shared/src/`, `docs/`, and `skills/`; no manifest path change is required. `tests/package-load.mjs` and `npm run pack:check` verify those existing boundaries.

## Evidence and Audit Outputs

Each Work Item creates or updates exactly one evidence note:

- execution baseline: `evidence/2026-08-21-execution-baseline.md`;
- WI-001: `evidence/2026-08-21-wi-001-scaffold.md`;
- WI-002: `evidence/2026-08-21-wi-002-contract.md`;
- WI-003: `evidence/2026-08-21-wi-003-shaping-planning.md`;
- WI-004: `evidence/2026-08-21-wi-004-execution-orchestration.md`; and
- WI-005 and final AC mapping: `evidence/2026-08-21-wi-005-final-verification.md`.

Every note uses this complete structure, replacing the descriptive title and contents with observed facts:

```markdown
Status: recorded
Created: 2026-08-21
Updated: 2026-08-21

# Descriptive observation title

## Purpose

The claim or Acceptance Criterion investigated.

## Source State

The source revision, worktree state, configuration, runtime, or environment that affects interpretation.

## Procedure

The exact commands or observation method.

## Observations

Observed results, including failures and surprises, plus links to captured artifacts.

## Limits

What the procedure does not establish.
```

Before WI-001 changes any production or test file, create the baseline note and capture content-bearing state:

```bash
BASE=.ledger/202608211538-redefine-ledger-task-artifact-model/evidence/.storage/execution-baseline
mkdir -p "$BASE"
git status --short --branch > "$BASE/git-status.txt"
git status --short -- .ledger/history > "$BASE/history-status.txt"
git diff --binary HEAD -- .ledger/history > "$BASE/history-working-tree.patch"
find .ledger/history -type f -exec shasum -a 256 {} + | LC_ALL=C sort > "$BASE/history.sha256"
```

The baseline note records these commands, summarizes their observed output, and links all four captured files. WI-005 repeats the patch and hash procedures into `evidence/.storage/execution-final/` and uses `cmp` against the baseline artifacts; this content comparison, not a name-only status, is the AC-005 archive-preservation evidence.

Use this canonical lifecycle-routing audit before WI-003 and after WI-003, WI-004, and WI-005:

```bash
LEDGER_ROUTE_PATTERN="(?i)(?:(?:record|write|keep|update|reconcile|track|own|remain|store|read|check|confirm)[^\n]{0,100}task(?:\\.md|['’]s)?[^\n]{0,45}(?:work items?|wi-###|assumptions?|journal|blockers?|evidence|review|retrospective|distillation)|(?:work items?|wi-###|assumptions?|journal|blockers?|evidence|review|retrospective|distillation)[^\n]{0,80}(?:in|into|under|from|on|of)[^\n]{0,30}task(?:\\.md|['’]s)?|(?:routine evidence|routine results|progress)[^\n]{0,60}task\\.md|\\.ledger/<task>/skills/)"
rg -nP --glob '!skills/skill-authoring/examples/**' --glob '!skills/skill-authoring/anthropic-best-practices.md' "$LEDGER_ROUTE_PATTERN" \
  AGENTS.md README.md components/shared/src/ledger-system-prompt.ts docs/ledger.md extensions/ledger.ts skills tests/ledger-add.test.ts tests/ledger-close.test.ts tests/ledger-prompt-integration.test.ts
LEDGER_SHORTHAND_PATTERN="(?i)(?:journal/evidence/review|task(?:\\.md|['’]s)?[^\n]{0,50}(?:work items?|assumptions?|journal|blockers?|evidence|review|retrospective|distillation) section|(?:work items?|assumptions?|journal|blockers?|evidence|review|retrospective|distillation) section[^\n]{0,50}(?:in|of|on|under)[^\n]{0,20}task(?:\\.md|['’]s)?|task-local (?:candidate )?(?:skills?|knowledge)|\\.ledger/<task>/skills/|reconcile[^\\n]{0,40}wi-### rows in task\\.md|\\[ledger review:|\\[ledger: wi-###|every ruling is a ledger entry|final material residuals[^\\n]{0,80}mark task blocked|block this task when load-bearing|record the blocker|ledger it)"
rg -nP --glob '!skills/skill-authoring/examples/**' --glob '!skills/skill-authoring/anthropic-best-practices.md' "$LEDGER_SHORTHAND_PATTERN" \
  AGENTS.md README.md components/shared/src/ledger-system-prompt.ts docs/ledger.md extensions/ledger.ts skills tests/ledger-add.test.ts tests/ledger-close.test.ts tests/ledger-prompt-integration.test.ts
LEDGER_ONTOLOGY_TERMS="(?i)(?:work items?|wi-###|assumptions?|journal|blockers?|evidence|review|retrospective|distillation|knowledge/|task-local (?:skills?|knowledge)|\\.ledger/<task>/skills/)"
rg -nP --glob '!skills/skill-authoring/examples/**' --glob '!skills/skill-authoring/anthropic-best-practices.md' "$LEDGER_ONTOLOGY_TERMS" \
  AGENTS.md README.md components/shared/src/ledger-system-prompt.ts docs/ledger.md extensions/ledger.ts skills tests/ledger-add.test.ts tests/ledger-close.test.ts tests/ledger-prompt-integration.test.ts
```

Record every match from all three searches in the current Work Item's evidence note. The broad ontology-term inventory is the completeness oracle: inspect every match in each listed file and classify it as a current artifact destination, a negative/prohibitory explanation, unrelated review/skill mechanics, or a stale destination requiring correction. The two focused patterns accelerate detection but never substitute for that path-by-path inventory. The final inventory may contain classified current/prohibitory/unrelated uses but no instruction that stores work items, assumptions, progress, blockers, evidence, review, retrospective, distillation, or task-local skills in `task.md` or its bundle root.

---

### WI-001: Replace the Ledger bundle scaffold

**State:** complete

**Dependencies:** None.

**Replanning:** None.

**Cancellation:** Not applicable.

**Evidence:** `evidence/2026-08-21-wi-001-scaffold.md`

**Acceptance:** AC-001, AC-002, and the scaffold portion of AC-005.

**Files:**
- Modify: `tests/ledger-add.test.ts`
- Modify: `extensions/ledger.ts`
- Regression only: `tests/ledger-close.test.ts`

**Interfaces:**
- Consumes: `addLedgerTask(rootInput, titleInput, descriptionInput, slugInput?, now?)` and the ordered root templates in the active specification.
- Produces: the unchanged `AddedLedgerTask` return shape plus a bundle containing `task.md`, `retrospective.md`, `specs/`, `plans/`, `research/`, `decisions/`, and `evidence/`.
- Preserves: `closeLedgerTask()` status rewriting, dependency identity, index rows, archival movement, file-mode handling, and collision cleanup.

**Step 1: Make the scaffold test express the new observable contract**

Replace the old directory and shaping-blocker assertions with exact root-file assertions. The key expectations are:

```ts
expect(readdirSync(join(root, result.bundlePath)).sort()).toEqual(
	["decisions", "evidence", "plans", "research", "retrospective.md", "specs", "task.md"].sort(),
);
expect(task).toBe(`Status: open
Created: 2026-08-17
Updated: 2026-08-17

# Implement bounded behavior

## Intent

Pending shaping.

## Outcome

Pending shaping.

## Scope

Pending shaping.

## Non-goals

- Pending shaping.

## Acceptance Criteria

- AC-001: Pending shaping.

## Constraints

- Pending shaping.

## References

- Pending shaping.
`);
expect(readFileSync(join(root, result.bundlePath, "retrospective.md"), "utf8")).toBe(`Status: pending
Created: 2026-08-17
Updated: 2026-08-17

# Retrospective

## Summary

Pending completion of the undertaking.

## What Worked

Pending completion of the undertaking.

## What Could Improve

Pending completion of the undertaking.

## Learnings

Pending completion of the undertaking.

## Improvements

Pending completion of the undertaking.
`);
```

**Step 2: Run the focused test and observe RED**

Run:

```bash
npx vitest run tests/ledger-add.test.ts
```

Expected: the structural-bundle test fails because `knowledge/` and `skills/` still exist, `retrospective.md` does not exist, and `task.md` still contains the old dashboard sections.

**Step 3: Implement the minimum scaffold change**

In `extensions/ledger.ts`:

```ts
const SUPPORTING_DIRECTORIES = ["specs", "plans", "research", "decisions", "evidence"] as const;
```

Replace `taskTemplate()` with the exact task template asserted above. Add:

```ts
function retrospectiveTemplate(date: string): string {
	return `Status: pending
Created: ${date}
Updated: ${date}

# Retrospective

## Summary

Pending completion of the undertaking.

## What Worked

Pending completion of the undertaking.

## What Could Improve

Pending completion of the undertaking.

## Learnings

Pending completion of the undertaking.

## Improvements

Pending completion of the undertaking.
`;
}
```

Create `retrospective.md` beside `task.md` with `flag: "wx"` inside the existing rollback boundary. Do not change close semantics or add format detection.

**Step 4: Verify GREEN and archival non-regression**

Run:

```bash
npx vitest run tests/ledger-add.test.ts tests/ledger-close.test.ts
```

Expected: both suites pass; the close suite proves the new additional root file does not alter archival/index behavior.

**Step 5: Record the verified increment**

Create `evidence/2026-08-21-wi-001-scaffold.md` with the required Evidence and Audit Outputs template. Record the RED/GREEN commands, observed results, source/worktree state, and limits. Link that exact path from WI-001, set its state to `complete`, and do not copy observations into `task.md`.

---

### WI-002: Replace the injected and durable Ledger contract

**State:** complete

**Dependencies:** WI-001, so documentation and prompt examples match the production scaffold.

**Replanning:** None.

**Cancellation:** Not applicable.

**Evidence:** `evidence/2026-08-21-wi-002-contract.md`

**Acceptance:** AC-003, the documentation portion of AC-004, and AC-005.

**Files:**
- Modify: `tests/ledger-prompt-integration.test.ts`
- Modify: `components/shared/src/ledger-system-prompt.ts`
- Rewrite in place: `docs/ledger.md`
- Modify: `AGENTS.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `appendLedgerSystemPrompt(systemPrompt: string): string`, the approved specification, and WI-001's exact root templates.
- Produces: one injected `<ledger-workbench>` contract and one durable documentation model with the same artifact owners and terminal predicate.
- Preserves: prompt tag/idempotence, root/child/worker distribution, `ledger_add`/`ledger_close` tool boundaries, index format, dependency resolution, and archive behavior.

**Step 1: Add prompt-boundary assertions**

Extend the existing idempotence test with assertions against the production prompt:

```ts
expect(twice).toContain("task.md is the durable statement of intent and acceptance");
expect(twice).toContain("specs/ holds optional behavioral contracts");
expect(twice).toContain("plans/ owns work-item decomposition and execution progress");
expect(twice).toContain("research/ owns inquiry, source citation, interpretation, and synthesis");
expect(twice).toContain("decisions/ records consequential choices and provenance");
expect(twice).toContain("evidence/ owns provenance-bearing validation observations");
expect(twice).toContain("retrospective.md is the single learning-and-improvement record");
expect(twice).toContain("specification: `draft | active | superseded`");
expect(twice).toContain("plan: `draft | active | complete | superseded`");
expect(twice).toContain("research: `active | complete | superseded`");
expect(twice).toContain("decision: `active | superseded`");
expect(twice).toContain("evidence: `recorded`");
expect(twice).toContain("retrospective: `pending | complete`");
expect(twice).toContain("An execution-changing assumption that is not operator-ratified");
expect(twice).toContain("The same observation must not be copied into both locations");
expect(twice).toContain("A task may be marked `done` only when");
expect(twice).toContain("every dependency resolves to a `done` task");
expect(twice).toContain("no referenced research, decision need, plan, or dependency still blocks the outcome");
expect(twice).toContain("no active plan remains, and every plan for the outcome is `complete` or `superseded`");
expect(twice).toContain("work complete or substantively cancelled with a rationale");
expect(twice).toContain("every Acceptance Criterion has adequate supporting evidence under `evidence/` with applicable limits");
expect(twice).toContain("every review finding and remediation is resolved, rejected with evidence, or explicitly bounded");
expect(twice).toContain("rationale, owner, and revisit condition");
expect(twice).toContain("`retrospective.md` is complete");
expect(twice).not.toContain("knowledge/");
expect(twice).not.toContain("skills/<slug>/SKILL.md");
expect(twice).not.toContain("Review, routine evidence, Journal");
```

Use wording that appears exactly once in the revised prompt and describes behavior rather than duplicating the whole specification.

**Step 2: Run the prompt test and observe RED**

Run:

```bash
npx vitest run tests/ledger-prompt-integration.test.ts
```

Expected: the new positive and negative assertions fail against the old injected contract.

**Step 3: Rewrite the injected contract from the approved specification**

Keep `LEDGER_SYSTEM_PROMPT_TAG`, `appendLedgerSystemPrompt()`, and idempotence unchanged. Replace only the `LEDGER_SYSTEM_PROMPT` content so it teaches:

```text
task.md -> intent, outcome, scope, non-goals, ACs, constraints, references
specs/ -> optional behavioral authority
plans/ -> work items, sequencing, progress, replanning, verification links
research/ -> inquiry, citations, analysis, conclusions, limits
decisions/ -> consequential choices and provenance
evidence/ -> validation observations, review reports/dispositions, procedure, environment, artifacts, limits
retrospective.md -> summary, process review, learnings, and actual durable improvements
```

Include the exact scaffold templates, supporting-record statuses, assumption routing, research/evidence linking rule, and complete `done` predicate from the specification. Remove all task-root progress/evidence/review/retrospective/distillation instructions and task-local knowledge/skill types.

**Step 4: Align durable documentation and repository guidance**

Rewrite `docs/ledger.md` around the same ontology and lifecycle without preserving an old/new comparison. Update `AGENTS.md` so it no longer says task evidence lives in `task.md`, no longer names separate retrospective/distillation, and routes progress/evidence/learning to plan, `evidence/`, and `retrospective.md`. Update the README Ledger paragraph and lifecycle-skill descriptions only where the current wording implies task-root progress or separate distillation.

The durable summary must state:

```markdown
- `task.md` preserves shaped intent and acceptance; it is not a progress dashboard.
- Plans own execution decomposition and observed progress.
- `evidence/` is the validation laboratory notebook, including review observations and dispositions.
- `retrospective.md` synthesizes process learning and names improvements made in their real project owners.
```

Do not change `package.json`, `THIRD_PARTY_NOTICES.md`, `docs/boundaries.md`, or archive examples: none is a consumer of the old scaffold semantics.

**Step 5: Verify prompt behavior and contract consistency**

Run:

```bash
npx vitest run tests/ledger-prompt-integration.test.ts
rg -n --glob '!node_modules/**' --glob '!.ledger/**' '(knowledge/|skills/<slug>/SKILL\.md|Review, routine evidence, Journal|Task status and evidence live in each task)' components/shared/src/ledger-system-prompt.ts docs/ledger.md AGENTS.md README.md
```

Expected: the Vitest suite passes and the focused search returns no stale contract statements. Legitimate repository `skills/` package paths are outside these forbidden patterns.

**Step 6: Record the verified increment**

Create `evidence/2026-08-21-wi-002-contract.md` with the required Evidence and Audit Outputs template. Record the prompt test, search procedure, observed output, and limits. Link that exact path from WI-002 and set its state to `complete`.

---

### WI-003: Route shaping and planning state to the new owners

**State:** complete

**Dependencies:** WI-002, because these skills specialize the injected contract.

**Replanning:** Independent review expanded the planning-skill correction to include explicit Work Item dependencies, the full state lifecycle, replanning/cancellation rationale, and proportionate active plans for bounded non-trivial work.

**Cancellation:** Not applicable.

**Evidence:** `evidence/2026-08-21-wi-003-shaping-planning.md`

**Acceptance:** the shaping/planning portion of AC-004 and AC-005.

**Files:**
- Modify: `skills/task-shaping/SKILL.md`
- Modify: `skills/task-shaping/visual-companion.md`
- Modify: `skills/task-shaping/spec-document-reviewer-prompt.md`
- Modify: `skills/implementation-planning/SKILL.md`
- Modify: `skills/implementation-planning/plan-document-reviewer-prompt.md`

**Interfaces:**
- Consumes: task template, optional specification boundary, plan ownership, and evidence/review destinations from WI-002.
- Produces: shaping that completes `task.md` before planning; planning that creates the canonical `WI-###` state in a plan; specification/plan review evidence under `evidence/`.
- Preserves: operator approval gates, active-spec authority, executable review adapter, stable observation IDs, and no execution before plan approval.

**Step 1: Capture the stale baseline**

Run the canonical lifecycle-routing audit from Evidence and Audit Outputs before editing. In `evidence/2026-08-21-wi-003-shaping-planning.md`, record every match and classify the matches in the five WI-003 files as an old destination, a valid prohibition, or unrelated wording. Expected: old task-root sections, task-local knowledge, task-owned Work Items, and task Review/Journal destinations are observed.

**Step 2: Rewrite shaping guidance**

Make task shaping primarily complete the ordered `task.md` fields and leave progress out of the root. Keep specifications optional and required only for significant behavioral semantics. Route:

```text
unresolved inquiry -> research/
ratified consequential choice -> decisions/
behavioral contract -> specs/
spec review observation/disposition -> evidence/
execution decomposition -> later plan
visual artifact -> evidence/.storage/visual-companion/
selected semantic conclusion -> specification or decision
```

Remove the `knowledge/` instruction and do not replace it with another task-local knowledge type. Update the specification reviewer template so the adapter result is recorded as an evidence note and material blockers return to shaping.

**Step 3: Rewrite planning guidance and its review template**

Make the plan file—not `task.md`—own each `WI-###` state, progress update, dependency, replanning note, and verification link. Replace old examples such as:

```markdown
**State:** open | active | blocked | complete | cancelled
**Evidence:** `.ledger/<task-id>/evidence/<note>.md`
```

Planning links the active plan from `task.md` References, but does not add a root checklist. RED/GREEN observations go into evidence notes; the plan records only their link and resulting execution state. Plan-review observations and dispositions go to `evidence/`, while remediation becomes plan work.

**Step 4: Verify the focused skills no longer teach old destinations**

Run the canonical lifecycle-routing audit again. Record and classify every match in the five WI-003 files. Expected: no unapproved destination remains in those files; matches elsewhere remain assigned to WI-004 or WI-005. Then run:

```bash
rg -n '(plans/|evidence/|retrospective\.md|specs/|decisions/)' \
  skills/task-shaping/SKILL.md \
  skills/implementation-planning/SKILL.md \
  skills/task-shaping/spec-document-reviewer-prompt.md \
  skills/implementation-planning/plan-document-reviewer-prompt.md
```

Expected: matches show the new owners explicitly. Review prose for semantic consistency; do not weaken the executable review gate.

**Step 5: Record the verified increment**

Complete `evidence/2026-08-21-wi-003-shaping-planning.md` using the required template, including the before/after audit classifications, positive-owner search, reviewed paths, observations, and limits. Link that exact path from WI-003 and set its state to `complete`.

---

### WI-004: Route execution, orchestration, investigation, and Ralph progress through plans and evidence

**State:** complete

**Dependencies:** WI-003, because execution consumes the plan format established there.

**Replanning:** Independent review identified stale DOT, scoped re-review, generic ruling/blocker, example, handoff-context, and typed prior-observation provenance paths. Remediation keeps exceptional state in the active plan, review observations/dispositions in evidence, passes explicit plan/relevant-evidence paths to every implementer/reviewer, and carries `reviewEvidencePath` through the fix gate.

**Cancellation:** Not applicable.

**Evidence:** `evidence/2026-08-21-wi-004-execution-orchestration.md`

**Acceptance:** the execution/orchestration portion of AC-004 and AC-005.

**Files:**
- Modify: `skills/plan-execution/SKILL.md`
- Modify: `skills/work-item-orchestration/SKILL.md`
- Modify: `skills/work-item-orchestration/implementer-prompt.md`
- Modify: `skills/work-item-orchestration/task-reviewer-prompt.md`
- Modify: `skills/work-item-orchestration/re-review-prompt.md`
- Modify: `skills/review-commissioning/review-gate.md`
- Modify: `skills/review-commissioning/references/ledger-gate.js`
- Modify: `skills/parallel-orchestration/SKILL.md`
- Modify: `skills/workspace-isolation/SKILL.md`
- Modify: `skills/root-cause-debugging/SKILL.md`
- Modify if inspection confirms stale routing: `skills/test-first-development/SKILL.md`
- Modify: `skills/ralph/SKILL.md`
- Modify: `skills/ralph/references/ledger-increment.md`

**Interfaces:**
- Consumes: an active plan with canonical Work Item states, governing task/spec/decisions, and plan-owned evidence links.
- Produces: plan progress updates, standalone evidence notes, evidence-hosted review packages, and shaping escalation for semantic ambiguity.
- Preserves: one writer per path, typed implementer boundaries, independent Work-Item/final review, SDD workspace scripts, Ralph iteration limits, and worker reports as claims until checked.

**Step 1: Capture stale execution destinations**

Run the canonical lifecycle-routing audit from Evidence and Audit Outputs. Create `evidence/2026-08-21-wi-004-execution-orchestration.md` and classify every match in the WI-004 files. Expected: task-owned progress, blockers, review, and evidence destinations are observed before editing.

**Step 2: Update sequential execution and investigation guidance**

Make `plan-execution` change the active Work Item's `State`, progress, replanning, and evidence link in the plan. A task enters `blocked` only as a summary state; the plan/research/decision/dependency owns the condition and is linked from task References. Route test-first and debugging observations to `evidence/`; promote only long-lived inquiry and synthesis to `research/`.

Use this recovery order consistently:

```text
task intent/acceptance -> active spec and decisions -> active plan state -> linked evidence observations -> repository state
```

**Step 3: Update orchestration and review-package guidance**

Make `work-item-orchestration` recover from the active plan's Work Item table and evidence links, not task Journal/Review sections. Keep plan-specific briefs and review packages under the existing `.ledger/<task>/evidence/sdd/<plan-basename>/` path. Record reviewer observations/dispositions in evidence notes; add remediation work and state transitions to the plan. Update implementer/reviewer/re-review prompts to receive the plan and prior evidence paths explicitly.

Make `parallel-orchestration` reconcile each worker claim into its owning plan/research/decision/evidence record rather than a root section. Workspace isolation records the chosen worktree/branch in the active plan. Do not change shell scripts unless a content search proves they themselves encode an old task-root destination.

**Step 4: Update Ralph's prepared-Ledger path**

Keep general Ralph caller-owned goals unchanged. For prepared Ledger tasks, make the active plan own iteration progress and blockers, `evidence/` own observed results/review, and `retrospective.md` remain closure-only. Update `references/ledger-increment.md`; do not modify the JavaScript topology unless it contains a concrete old destination after inspection.

**Step 5: Verify execution routing**

Run the canonical lifecycle-routing audit again and classify every match in the WI-004 files. Expected: no unapproved destination remains there; matches assigned to WI-005 remain open. Then run:

```bash
rg -n '(active plan|evidence/|research/|decisions/)' \
  skills/plan-execution \
  skills/work-item-orchestration \
  skills/parallel-orchestration \
  skills/workspace-isolation \
  skills/root-cause-debugging \
  skills/test-first-development \
  skills/ralph
```

Expected: every lifecycle area has an explicit current owner. Run existing script-level regressions:

```bash
npx vitest run tests/sdd-review-package.test.ts tests/ledger-visual-companion.test.ts
```

Expected: both suites pass without changing their storage behavior.

**Step 6: Record the verified increment**

Complete `evidence/2026-08-21-wi-004-execution-orchestration.md` using the required template, including audit classifications, Vitest results, source state, and limits. Link that exact path from WI-004 and set its state to `complete`.

---

### WI-005: Align review, completion, closure, and skill improvement guidance

**State:** complete

**Dependencies:** WI-004, because closure validates the execution artifacts established there.

**Replanning:** Review tightened the terminal predicate, failure ownership, decision/research authority, evidence recovery, and parallel boundaries. The operator then explicitly directed closure, commit, and push with the known clean-HEAD format/lint residual, ending further review iterations.

**Cancellation:** Not applicable.

**Evidence:** `evidence/2026-08-21-wi-005-final-verification.md`, `evidence/2026-08-21-whole-change-review.md`

**Acceptance:** the review/closure/learning portion of AC-004, AC-005, and AC-006.

**Files:**
- Modify: `skills/review-commissioning/SKILL.md`
- Modify: `skills/review-commissioning/review-gate.md`
- Modify: `skills/review-commissioning/code-reviewer.md`
- Preserve unless inspection finds a semantic destination: `skills/review-commissioning/references/ledger-gate.js`
- Modify: `skills/review-reconciliation/SKILL.md`
- Modify: `skills/completion-verification/SKILL.md`
- Modify: `skills/task-closure/SKILL.md`
- Modify: `skills/skill-authoring/SKILL.md`

**Interfaces:**
- Consumes: complete/superseded plans, acceptance-mapped evidence, review evidence/dispositions, task dependencies and status, and the pending retrospective.
- Produces: evidence-hosted review records, plan-owned remediation, criterion-matched completion evidence, a completed `retrospective.md`, and improvements in real repository/configured-skill owners.
- Preserves: typed review/verifier topology, stable observation IDs, material-blocker gates, evidence-not-authority, operator-owned archival/integration, and configured skill discovery paths.

**Step 1: Capture stale review and closure destinations**

Run the canonical lifecycle-routing audit from Evidence and Audit Outputs. Create `evidence/2026-08-21-wi-005-final-verification.md` and classify every match in the WI-005 files. Expected: the old root review ledger, routine-evidence exception, separate retrospective/distillation, and task-local skill candidate path are observed before editing.

**Step 2: Move review records and remediation to their approved owners**

Across review commissioning, its gate instructions/templates, and reconciliation:

```text
review observation + verifier disposition + coverage gap + residual risk -> evidence/<review-note>.md
confirmed remediation state and work -> active plan
semantic conflict -> shaping/specification/decision
independent out-of-scope outcome -> separate task or explicit no-action rationale
```

Keep `references/ledger-gate.js` unchanged unless it names a concrete storage destination; its schemas and `materialBlockers` computation are execution mechanics, not artifact policy.

**Step 3: Rewrite completion and closure around the terminal predicate**

Completion verification maps every `AC-###` to fresh evidence notes and documented limits. Closure checks dependencies, no owning record remains blocking, no active plan remains, plan work is complete/cancelled with rationale, review findings are resolved/rejected/bounded, acceptance evidence is adequate, and `retrospective.md` is complete. Replace separate Retrospective/Distillation instructions with this exact root structure:

```markdown
# Retrospective

## Summary
## What Worked
## What Could Improve
## Learnings
## Improvements
```

`Improvements` names actual changes to `AGENTS.md`, docs, tests, runbooks, configured skills, or a separately owned follow-up task; a substantive no-promotion rationale is allowed. `ledger_close` remains an operator-authorized archive action and never judges completeness.

**Step 4: Remove task-local skill-authoring candidates**

Retain the existing configured skill locations:

```text
package: skills/<name>/
trusted project: .pi/skills/ or .agents/skills/
personal: ~/.pi/agent/skills/ or ~/.agents/skills/
```

Use the governing task/plan/evidence records for the behavioral hypothesis and treatment observations, but create the candidate in its intended configured owner rather than `.ledger/<task>/skills/`. Remove task-local skill discovery or promotion semantics without changing unrelated authoring best-practice references/examples.

**Step 5: Verify the lifecycle corpus and package surface**

Run the canonical lifecycle-routing audit again over its full active-surface perimeter. Record and classify every match in `evidence/2026-08-21-wi-005-final-verification.md`. Expected: no unapproved destination remains anywhere; a remaining negative/prohibitory statement is acceptable only when the evidence note quotes and classifies it.

Run the full relevant proof sequence:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run pack:check
```

Expected: every command exits 0. Inspect `npm run pack:check` output to confirm `extensions/ledger.ts`, `components/shared/src/ledger-system-prompt.ts`, `docs/ledger.md`, and all changed lifecycle skill files are included.

Capture and compare final archive state:

```bash
FINAL=.ledger/202608211538-redefine-ledger-task-artifact-model/evidence/.storage/execution-final
BASE=.ledger/202608211538-redefine-ledger-task-artifact-model/evidence/.storage/execution-baseline
mkdir -p "$FINAL"
git status --short -- .ledger/history > "$FINAL/history-status.txt"
git diff --binary HEAD -- .ledger/history > "$FINAL/history-working-tree.patch"
find .ledger/history -type f -exec shasum -a 256 {} + | LC_ALL=C sort > "$FINAL/history.sha256"
cmp "$BASE/history-working-tree.patch" "$FINAL/history-working-tree.patch"
cmp "$BASE/history.sha256" "$FINAL/history.sha256"
git diff --check
```

Expected: both `cmp` commands and `git diff --check` exit 0. This proves archived content and any pre-existing archived working-tree delta are unchanged by execution.

Inspect the bounded active-surface diff for forbidden compatibility machinery:

```bash
git diff --name-status HEAD -- AGENTS.md README.md components extensions docs skills tests package.json
git diff --unified=3 HEAD -- AGENTS.md README.md components extensions docs skills tests package.json \
  > .ledger/202608211538-redefine-ledger-task-artifact-model/evidence/.storage/execution-final/active-surface.patch
rg -n '(compatib|migrat|schema.?version|legacy|old/new|fallback|_v2|new_)' \
  .ledger/202608211538-redefine-ledger-task-artifact-model/evidence/.storage/execution-final/active-surface.patch
```

Expected: the name-status output contains only planned owners. Inspect and classify every term match; statements explicitly rejecting migration/compatibility are acceptable, while no runtime branch, parser, schema version, fallback, duplicate owner, or newly added active-surface file is allowed. Record the name-status output and each classification in the WI-005 evidence note.

**Step 6: Record completion evidence and plan state**

Complete `evidence/2026-08-21-wi-005-final-verification.md` with the required template and map AC-001 through AC-006 to the exact prior evidence paths, final commands, observed results, compatibility-term classifications, and limits. Link that exact path from WI-005. Set WI-005 and this plan to `complete` only after all checks and review remediation are resolved. Do not mark the task `done`; task closure and archival remain separate steps.

## Acceptance Coverage

| Acceptance Criterion | Owning Work Item | Falsifying/confirming evidence |
| --- | --- | --- |
| AC-001 | WI-001 | Focused `ledger-add` test observes the exact root files/directories and retrospective scaffold. |
| AC-002 | WI-001 | Exact `task.md` assertion fails on any removed dashboard section or missing intent field. |
| AC-003 | WI-002 | Production prompt integration assertions plus durable-contract search cover every artifact owner. |
| AC-004 | WI-003, WI-004, WI-005 | Focused stale-destination searches and existing skill-adjacent tests cover shaping, planning, execution, review, closure, and authoring guidance. |
| AC-005 | WI-001 through WI-005 | Pre-edit/final archive patch and hash comparison proves preserved history content; bounded active-surface diff inspection classifies compatibility terms and rejects migration, fallback, schema-version, duplicate-owner, or old/new implementation. |
| AC-006 | WI-005 | Formatting, lint, typecheck, full tests, loader coverage through `npm test`, package dry-run inspection, and diff hygiene. |

## Integration Order and Recovery

1. Capture the content-bearing execution baseline, then WI-001 changes observable scaffold behavior.
2. WI-002 makes the injected and durable contract match that behavior.
3. WI-003 updates pre-execution producers of task/spec/plan/review state.
4. WI-004 updates execution consumers and plan/evidence recovery paths.
5. WI-005 updates terminal review/closure/learning consumers and runs whole-package verification.

If work stops, the active Work Item and last completed step are recorded in this plan; observations and command output remain under `evidence/`. On resume, read the task, active specification, this plan, linked evidence, and current repository state in that order. Never infer completion from the transcript or from a worker report alone.

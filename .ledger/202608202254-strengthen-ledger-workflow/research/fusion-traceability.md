Status: active
Created: 2026-08-20
Updated: 2026-08-20

# Superpowers-to-Apple-Pie traceability matrix

## Question Or Hypothesis

How can every material instruction, role prompt, helper, artifact, and bootstrap invariant in Superpowers `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` be retained or enhanced in one apple-pi workflow without inventing APIs or creating duplicate Ledger state?

## Sources And Methods

The complete upstream checkout at `/tmp/apple-pi-superpowers-main` was read together with its Pi extension, package manifest, porting guide, cross-harness delivery material, helper scripts, workflow prompts, tests, and MIT license. Current apple-pi sources were read at `skills/`, `extensions/ledger.ts`, `components/shared/src/ledger-system-prompt.ts`, `docs/ledger.md`, `docs/subagents.md`, `docs/exec.md`, `docs/advisor.md`, `docs/boundaries.md`, `package.json`, and `THIRD_PARTY_NOTICES.md`.

Disposition labels:

- **Retain** — preserve close upstream wording and force.
- **Adapt** — preserve behavioral force while changing apple-pi terminology, tool mapping, authority, or task storage.
- **Translate** — preserve behavior through an existing apple-pi primitive rather than copying a foreign harness mechanism.
- **Boundary** — retain the purpose but make a higher-priority apple-pi safety or operator-authority constraint explicit.

A material passage is retained by default. An omission, relocation, or altered instruction requires a specific owner and rationale in the implementation plan; “apple-pi already has something similar” is not sufficient.

## Findings

### Workflow skills

| Upstream source | Material behavior to retain | apple-pi owner and disposition |
| --- | --- | --- |
| `using-superpowers/SKILL.md` | Mandatory skill-before-action routing; process skills before implementation; brainstorm before plan; explicit red-flag/rationalization counters; user instructions outrank skills; dispatched workers do not restart the root routing loop. | **Adapt:** root-only injected workflow prompt. It checks the skill catalog before action, loads a real applicable `SKILL.md` at the 1% threshold, and names Ledger, `ask_user_question`, `Agent`, `pi_exec`, Ralph, and `pi-review`. Root extension owns activation; Ledger remains its own durable-state prompt; child/worker role prompts do not inherit root routing. |
| `brainstorming/SKILL.md` | Three-path spike/bounded/architectural classifier; complexity may only escalate; one-question clarification; alternative comparison/YAGNI; sectioned design; explicit approval gate; spec self-review/user review; existing-code discipline; visual companion offered only when visual feedback is useful. | **Adapt:** `ledger-shape-task` owns classification, approval, and task scaling; `ledger-specify-task` owns written approved design; a task-local active spec/decision carries durable approval. Add a one-off path so known reversible work does not acquire task ceremony. Use Design/visual companion only when useful. |
| `writing-plans/SKILL.md` | Fresh-executor plan; independent subsystem split; source-backed file/interface responsibility; independently testable/reviewable tasks; explicit intended failure/minimal implementation/pass sequence; no placeholders; self-review; explicit execution handoff. | **Adapt:** `ledger-plan-task` owns close wording and task-local plans. Stable `WI-###` becomes the single durable task list. Preserve exact code/interface detail where necessary; remove only time estimates and self-authorizing commit steps. Handoff selects Agent SDD or Ralph. |
| `executing-plans/SKILL.md` | Preflight plan challenge; ordered execution; verification per step; stop/revisit on gaps; finishing after verified work. | **Adapt:** `ledger-execute-task` owns plan readiness, route selection, Ledger reconciliation, and stop conditions. Worktree/finishing are explicit skills under operator authority. |
| `subagent-driven-development/SKILL.md` | Fresh scoped implementer, preflight conflict scan, capability selection, focused task briefs, status routing, task review, scoped re-review, broad final review, rationalization counters, durable recovery, and concise controller narration. | **Adapt/Translate:** a dedicated Agent SDD route in `ledger-execute-task`; typed `Agent` Implement children are fresh and `inherit_context:false`, while `pi-review` owns independently verified task/fix/final reviews. Ledger replaces the SDD workspace/progress file. `Agent` resume/steer implements continued worker ownership. Consequential semantic uncertainty remains blocking; a universal retry cap cannot turn an unresolved significant issue into completion. |
| `dispatching-parallel-agents/SKILL.md` | Parallelize only genuinely independent domains; self-contained prompts; integrate combined results and checks; keep dependent work sequential. | **Translate:** `pi_exec` `parallel`, structured `agents.run`, explicit contexts, output schemas, limits, and combined verification. The root controller chooses `Agent` only where persistent collaboration is needed. |
| `systematic-debugging/SKILL.md` | Root-cause-before-fix iron law; reproduction; error/context/diff/environment inspection; boundary instrumentation; backward tracing; reference comparison; one falsifiable hypothesis; one-variable test; focused fix; architecture escalation after repeated failure; no-root-cause limits; rationalization counters. | **Retain/Adapt:** dedicated apple-pi debugging skill referenced by Ledger research/execution and Ralph. Investigation is recorded in `research/` or task Journal; Explore/Research/Counsel provide actual apple-pi lanes. |
| `test-driven-development/SKILL.md` | Test-first iron law; correct RED observation; minimal GREEN; clean verification; refactor only after green; real behavior over mocks; edge/error coverage; rationalization counters and checklist. | **Adapt/Boundary:** dedicated apple-pi TDD skill and plan/Ralph/Agent references. A feasible behavioral check requires RED/GREEN evidence; documentation, process, deployment, and other non-behavior criteria require an explicit criterion-matched alternative rather than invented tests. Never delete unowned/pre-existing work to recreate RED. |
| `verification-before-completion/SKILL.md` | Fresh claim-matched proof; full result/exit/failure inspection; requirement-level evidence; delegation verification; red-green regression proof; failure reporting rather than success-shaped claims. | **Retain/Adapt:** dedicated skill plus Ledger evidence/closure wording. A proving “command” generalizes to a concrete procedure for non-code criteria. Worker reports and stale checks remain unverified claims. |
| `requesting-code-review/SKILL.md` | Mandatory review triggers, scoped base/head/context, severity disposition, technical challenge to bad feedback, no skipped review. | **Translate:** `pi-review` shapes, prompt templates, candidate verification, coverage reporting, and Ledger Review disposition. Keep upstream trigger wording and request context but use current comparison semantics and no generic reviewer API. |
| `receiving-code-review/SKILL.md` | Read/understand/verify/evaluate/respond/implement sequence; clarify before partial action; severity ordering; compatibility/context/YAGNI checks; technical pushback; test each correction; non-performative response rules. | **Retain/Adapt:** dedicated receiving-review skill plus `ledger-execute-task` review reconciliation. `pi-review` candidates are unconfirmed until independently verified. GitHub thread writing stays an explicitly authorized external action. |
| `using-git-worktrees/SKILL.md` | Detect linked worktree/submodule; ask consent; native owner first; safe ignored location; setup; clean baseline; visible sandbox fallback; rationalization counters. | **Adapt/Boundary:** dedicated worktree skill. Preserve every stage and safety check, but never edit `.gitignore`, create a worktree, install globally, or work in place without required operator authority. Use a managed environment if explicitly supplied; otherwise use ordinary Git only after consent. |
| `finishing-a-development-branch/SKILL.md` | Fresh full verification; environment/base detection; merge/PR/keep menu; merged-result test; explicit discard; provenance-aware cleanup; no force removal of unique work. | **Adapt/Boundary:** dedicated finishing skill after verification/distillation. Preserve all explicit choices and destructive confirmation; commits, pull, merge, push, PR, and deletion remain operator-authorized. Ledger records authority/evidence but does not own Git state. |
| `writing-skills/SKILL.md` | Skill TDD; baseline/treatment/pressure/recognition/retrieval tests; fresh contexts/control; five-plus repetitions; manual result review; loophole/rationalization closure; discoverable skill structure; promotion discipline. | **Adapt:** dedicated apple-pi skill. Evaluation runs disposable **root** Pi sessions in Git sandboxes with normal root prompt/tools—not typed specialist lanes. Task-local candidate skills can promote only after evaluation. |

### Role prompts, references, and helpers

| Upstream material | Preserved behavior | apple-pi translation |
| --- | --- | --- |
| `brainstorming/spec-document-reviewer-prompt.md` | Calibrated completeness/consistency/clarity/scope/YAGNI design review. | Read-only `pi_exec` specification-review reference under `ledger-specify-task`; blocking semantic issues remain task blockers. |
| `brainstorming/visual-companion.md`, `scripts/start-server.sh`, `stop-server.sh`, `server.cjs`, `helper.js`, and frame template | Just-in-time visual design loop, authenticated local server, event queue, terminal-primary feedback, restart/cleanup safety. | Ledger-aware visual-companion reference and helpers. Durable selected content belongs in task records; PID/token/events are owned ephemeral state. Retain auth/origin/identity/cleanup tests and remove only upstream branding/remote telemetry. |
| `writing-plans/plan-document-reviewer-prompt.md` | Detailed plan review against requirements, interfaces, ordering, tests, and buildability. | Bounded read-only `pi_exec` plan-review reference used by `ledger-plan-task`, with explicit advisory/blocking results. |
| `subagent-driven-development/implementer-prompt.md` | Scoped implementer contract, clarification, self-review, tests, status, no child delegation. | Agent SDD Implement prompt appended through actual `Agent` `system_prompt`; Ledger paths/WI sections replace report files and worker commits remain operator-owned. |
| `subagent-driven-development/task-reviewer-prompt.md` | Task spec/quality review, report skepticism, bounded traversal, calibrated issue output. | `pi-review` task-gate reviewer/verifier prompts; preserve task and quality verdicts while using candidate/confirmed distinction. |
| `subagent-driven-development/re-review-prompt.md` | Reassess original findings and fix-caused breakage without relitigating the whole change. | Targeted `pi-review` fix re-review shape with verifier dispositions for each confirmed finding. |
| `subagent-driven-development/scripts/sdd-workspace` | Plan-scoped recovery state, no stale-plan conflation. | **Translate:** no script or `.superpowers` directory. One task root and its active plan/WIs/Journal/Review are already plan-scoped durable state. |
| `task-brief` | Prevent large plan/transcript dumps while giving an implementer exact task context. | **Translate:** worker gets WI ID and concrete plan/spec paths/section reference via `Agent` context; no duplicate durable brief file. |
| `review-package` | Exact review range/stat/diff without controller context bloat. | **Translate:** `std.git.change`, compact contexts, `pi_exec` traces, explicit current path/range contract, and task Review results. |
| `systematic-debugging/root-cause-tracing.md`, `defense-in-depth.md`, `condition-based-waiting.md`, `find-polluter.sh`, examples and pressure files | Backward tracing, justified layered validation, condition waits, pollution isolation, and failure-pressure instruction tests. | Dedicated debugging skill references/helpers and root-session evaluation fixtures. Generalize technology-specific examples without weakening required investigation behavior. |
| `test-driven-development/writing-good-tests.md` | Mutation-derived cases, real components, mock boundary, complete doubles, test utilities, warning signs. | TDD progressive-disclosure reference, close wording retained. |
| `requesting-code-review/code-reviewer.md` | Whole-change rubric, strengths, correctness/architecture/tests assessment, calibrated severity/readiness. | Expand current planner/reviewer/verifier prompts and final-review focuses while retaining trigger/evidence/impact standard. |
| `writing-skills/anthropic-best-practices.md`, `persuasion-principles.md`, `testing-skills-with-subagents.md`, Graphviz helper/conventions, example | Skill discovery, ethical compliance language, adversarial evaluation, diagrams, and evaluation examples. | Writing-skills references retargeted to root Pi evaluation and package conventions. Existing evaluated Superpowers description policy is retained where it differs from generic advice. |

### Bootstrap, portability, and distribution material

| Upstream material | Preserved invariant | apple-pi owner |
| --- | --- | --- |
| `.pi/extensions/superpowers.ts`, `tests/pi/test-pi-extension.mjs` | Package-registered skill discovery, automatic idempotent root bootstrap, compaction resilience, explicit tool mapping, and testable failure behavior. | New apple-pi **root-only** workflow extension. It is package-loaded in root sessions; interactive children and `pi_exec` workers load only explicit safe extensions and therefore do not receive it. It must fail visibly if its source is absent, inject exactly once, and retain root workflow after compaction. |
| `docs/porting-to-a-new-harness.md` Parts 1–8 and appendices | Skills name actions not foreign tools; automatic start; real capability mapping; no user-config mutation; empirical clean-session verification; install/packaging and cross-platform discipline. | `docs/workflow.md`, root workflow extension tests, package load/pack checks, and one apple-pi tool mapping. Foreign plugin manifests/hooks are traceability evidence, not local compatibility runtime. |
| Hook scripts/manifests and OpenCode/Gemini/Kimi/Codex/Cursor/Claude/Devin/Hermes integration files | Bootstrap delivery, dedup, tool mapping, native package distribution, and failure modes across hosts. | One native Pi extension plus one mapping; retain all behaviorally relevant invariants and document why foreign delivery implementations are not copied. |
| `README.md`, `CLAUDE.md`, contribution/evaluation guidance, release notes | Complete happy path, workflow philosophy, evidence requirements, and reasons current wording exists. | apple-pi README/workflow documentation and traceability notes. Existing contribution-specific rules become provenance unless they govern package behavior. |
| `LICENSE` | MIT permission and copyright retention. | `THIRD_PARTY_NOTICES.md` before any literal import; package review ensures the notice and local path inventory are shipped. |

### First increment source anchors

The first implementation increment uses these exact upstream anchors. The local paths named here are also the paths listed in `THIRD_PARTY_NOTICES.md` when they contain close-adapted source behavior.

| Upstream anchor | Retained or adapted behavior | apple-pi owner and rationale |
| --- | --- | --- |
| `skills/using-superpowers/SKILL.md:6-24` | Subagent stop boundary, non-negotiable skill-before-action rule, pre-plan process gate, announcement, and checklist discipline. | **Adapt:** `components/shared/src/workflow-system-prompt.ts` retains the force, requires catalog check plus 1%-threshold loading with the real `read` path, uses Ledger Work Items, and states explicit child/worker handoff. |
| `skills/using-superpowers/SKILL.md:26-31` | Process skills precede implementation skills and request class selects the first process. | **Adapt:** the injected prompt routes build, bug, review, and bounded execution to existing Ledger, Ralph, and pi-review procedures; unavailable narrower skills fail visibly rather than becoming invented APIs. |
| `skills/using-superpowers/SKILL.md:33-50` | Full red-flag/rationalization table and stop-before-action behavior. | **Adapt:** `components/shared/src/workflow-system-prompt.ts` retains the table and changes only wording needed for apple-pi's root/worker and native-tool boundary. |
| `skills/using-superpowers/SKILL.md:52-59` | Harness-specific adaptation is explicit rather than silently assumed. | **Translate:** the injected prompt names the actual apple-pi/Pi skill and tool surface; foreign harness reference files are not shipped. |
| `skills/using-superpowers/SKILL.md:61-63` | Direct user instructions outrank skills and are the only authority to skip a workflow. | **Retain/Boundary:** the injected prompt preserves precedence while adding apple-pi safety and external/destructive-action limits. |
| `.pi/extensions/superpowers.ts:6-21` | Bootstrap marker, package skill location, and automatic skill-resource discovery. | **Adapt/Translate:** `components/shared/src/workflow-system-prompt.ts`, `extensions/workflow.ts`, and `package.json` use the package's existing `./skills` manifest and a root `before_agent_start` prompt instead of a parallel resource hook or a separate routing skill. |
| `.pi/extensions/superpowers.ts:35-56` | Inject the bootstrap once at a stable context location and avoid duplicate messages. | **Adapt:** `components/shared/src/workflow-system-prompt.ts` appends one tagged system-prompt block idempotently. apple-pi's existing root prompt assembly makes a context user-message copy unnecessary; package and prompt tests exercise the exact-once invariant. |
| `.pi/extensions/superpowers.ts:59-97` | Load bootstrap content and provide native Pi skill/core/subagent/task mappings; source loading failure must not be mistaken for activation. | **Adapt/Boundary:** `extensions/workflow.ts` injects the canonical root prompt; that prompt checks the available skill catalog and loads real applicable skills with `read`, then maps Ledger, `ask_user_question`, `Agent`, `pi_exec`, Ralph, pi-review, and lowercase core tools. Generic task-list/subagent fallbacks are explicitly rejected rather than invented. |
| `tests/pi/test-pi-extension.mjs:45-136` | Verify package registration, lifecycle registration, startup/compaction deduplication, and Pi mapping coverage. | **Adapt:** `tests/package-load.mjs` and `tests/ledger-prompt-integration.test.ts` verify apple-pi package loading, root prompt exact-once behavior, actual mappings, and unchanged child/worker extension lists; the old context-message and foreign task-list checks are not copied. |
| `LICENSE:1-21` | MIT permission, warranty disclaimer, and copyright retention. | **Retain:** `THIRD_PARTY_NOTICES.md` records commit `b36e0829c6d0140e93cfef2ca599b1b07d4a7797`, Jesse Vincent's notice, and every local adapted path. |

### State translation

| Superpowers artifact | Single apple-pi owner |
| --- | --- |
| Design approval and consequence | Task Assumptions/Journal; decision record when consequential. |
| Design document | Active task-local specification. |
| Implementation plan and task list | Active plan plus canonical `task.md` Work Items. |
| SDD progress/reports/fix rounds/rulings | Task Status, Journal, Blockers, Evidence, Review, and decisions; no duplicate workspace. |
| Task brief and review package | Bounded `Agent`/`pi_exec` context and durable operation trace, not a duplicate durable file. |
| Review candidate/final review | `pi-review` candidate/verifier lifecycle, then task Review only for confirmed/bounded results. |
| RED/GREEN output | Criterion-mapped task Evidence with procedure, result, scope, and limits. |
| Visual content | Selected durable content in task records; owned transient process state outside the Ledger. |
| Worktree/branch/commit/PR | Git/forge are authoritative; Ledger records only relevant evidence and operator authority. |
| Skill evaluation transcript | Task-local evaluation storage and its evidence record. |

## Conclusions

The source can be fused nearly wholesale only by making its global workflow an active root-session contract and translating its existing multi-file state machine into Ledger records plus authentic apple-pi primitives. The first production increment must establish that canonical entry and close textual/source traceability. Every subsequent implementation step must update this matrix with exact retained/adapted source passages and corresponding local paths.

## Limits

- This record is a section-level inventory, not a line-by-line diff. The implementation plan must add exact upstream section/line anchors before close wording is copied or materially changed.
- No root-session behavior result is valid yet: the initial `Plan`-lane pilot was invalid, and the one root smoke run used a non-Git copy. The corrected disposable-root Git-sandbox method is required.
- The visual-companion and utility-port scope requires separate source/license/security inspection before implementation; this record establishes that it cannot be silently omitted.

## Related Records

- `.ledger/202608202254-strengthen-ledger-workflow/decisions/fusion-scope.md`
- `.ledger/202608202254-strengthen-ledger-workflow/specs/apple-pie-superpowers-fusion.md`
- `.ledger/202608202254-strengthen-ledger-workflow/research/baseline-evaluation-design.md`
- `.ledger/202608202235-evaluate-superpowers-ledger-integration/research/superpowers-main-methodology.md`

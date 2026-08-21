Status: active
Created: 2026-08-20
Updated: 2026-08-20

# Delivery plan for the apple-pi Superpowers fusion

## Outcome

Deliver one discoverable, root-session apple-pi workflow that retains Superpowers' full methodology and happy path at upstream commit `b36e0829c6d0140e93cfef2ca599b1b07d4a7797`, while mapping all actions and durable state to Ledger, `Agent`, `pi_exec`, Ralph, `pi-review`, Advisor, and operator authority.

Implementation begins only after the operator approves this active specification and plan. The approval must cover the complete workflow, not merely the bootstrap.

## Current-System Evidence

- `extensions/ledger.ts` appends the Ledger contract from `components/shared/src/ledger-system-prompt.ts` via `before_agent_start`. Its explicit load in child and worker processes makes it the correct durable-state owner, but unsuitable for root-only workflow routing.
- `package.json` loads package extensions only in root Pi sessions. Interactive child sessions and disposable `pi_exec` workers start with `--no-extensions` and explicitly load Ledger/session-search (children also MCP), so a new package extension is root-only by construction.
- `components/subagents/src/installer.ts` injects the root team catalog and distinguishes interactive `Agent` sessions from `pi_exec` workers. `docs/subagents.md` assigns persistent collaboration to `Agent`, not to a generic task API.
- `pi_exec`, Ralph, and `pi-review` already provide bounded program composition, fresh sequential implementation, and independent candidate verification. A fused skill must orchestrate these owners rather than duplicate them.
- `tests/ledger-prompt-integration.test.ts` and `tests/package-load.mjs` already prove prompt-distribution and explicit-package-boundary patterns; they are the test seams for a root workflow extension and package additions.
- `research/fusion-traceability.md` is the source inventory and required translation matrix. It is a planning input, not a substitute for exact source attribution at import time.

## Change Surfaces

| Surface | Responsibility | Planned change |
| --- | --- | --- |
| `components/shared/src/workflow-system-prompt.ts` (new) | Root-only injected workflow prompt | Build an idempotent Superpowers-derived entry contract: catalog check, 1%-applicability skill loading, process priority, actual apple-pi action mapping, full happy path, and root-versus-worker boundary. It is the routing contract; there is no separate `using-apple-pi` skill. |
| `extensions/workflow.ts` (new) | Root package registration | Append the injected prompt through `before_agent_start`; bootstrap failure remains visible. This extension is absent from explicit child/worker extension lists. |
| `package.json`, `tests/package-load.mjs`, `tests/ledger-prompt-integration.test.ts` | Public surface and deterministic proof | Register/load the extension; test exact-once injection, prompt ordering, root-only isolation, package loading, and the actual catalog/applicability mapping. |
| Existing Ledger lifecycle skills and new process skills | Complete retained methodology | Rework `ledger-shape-task`, `ledger-research-task`, `ledger-specify-task`, `ledger-plan-task`, `ledger-execute-task`, and `ledger-distill-close-task`; add dedicated close adaptations for debugging, TDD, verification, receiving review, worktrees, finishing, and writing skills. Add prompts/references only where a concrete workflow consumer loads them. |
| `skills/pi-ralph/`, `skills/pi-review/` | Existing execution/review owners | Translate upstream execution/review behavior into their current owners: Agent SDD route and Ralph selection under `ledger-execute-task`; task/fix/final review topology in `pi-review`; retain bounded context, independent verification, and no implicit completion. |
| `docs/workflow.md` (new), `README.md`, `docs/ledger.md`, `docs/subagents.md`, `docs/exec.md` | Durable user/maintainer contract | Describe one happy path, exact route selection, artifact translation, operator integration choices, and root/bootstrap boundary. Update existing docs only where their stated behavior changes. |
| `THIRD_PARTY_NOTICES.md` | Provenance | Add `obra/superpowers`, exact commit, MIT notice/copyright, and every local path containing literal or materially adapted source. |
| Visual companion helpers and tests | Upstream material that cannot be silently dropped | First isolate upstream helper/security/protocol code into a dedicated planned increment. Port it only after exact review of its dependencies, licensing, local storage, authentication, and package inclusion. |

## Sequence

1. **Freeze source-level traceability and attribution.**
   - Expand `research/fusion-traceability.md` with exact upstream section/line anchors before each literal or close adaptation.
   - Add the required third-party notice before importing wording or code.
   - Create a deterministic inventory test or script only if it is consumed by package validation; otherwise retain the matrix as the source-of-truth review artifact.

2. **Install and prove the root workflow entry.**
   - Add the root prompt builder and root extension.
   - Close-adapt `using-superpowers` directly into the injected root prompt, including catalog check, 1%-applicability loading, complete apple-pi mapping, Ledger, `ask_user_question`, `Agent`, `pi_exec`, Ralph, `pi-review`, normal tools, and unavailable-primitive failure behavior. Do not create a separate routing skill.
   - Prove prompt injection is idempotent, appears in root sessions, remains after compaction according to Pi’s current prompt lifecycle, and does not appear in explicit child or disposable worker starts.
   - Run a disposable root Pi acceptance turn from an untouched Git sandbox; retain the full transcript and lifecycle conditions.

3. **Port intent, design, and plan semantics into Ledger stages.**
   - Adapt brainstorming and its design-review behavior into shaping/specification; preserve spike/bounded/architectural routes, question/approval gates, alternatives, YAGNI, spec self-review, and task scaling.
   - Adapt writing-plans, plan-document review, and execution-plan preflight into planning/execution; preserve testable WI-aligned increments, exact interfaces/paths where needed, expected-failure evidence, no placeholders, and explicit Agent-SDD/Ralph handoff.
   - Ensure every upstream state artifact maps to one existing Ledger record consumer; do not create duplicate checklists, progress files, or `.superpowers` directories.

4. **Port discipline and evaluation skills.**
   - Add close adaptations of systematic debugging (with its source-tracing, waiting, and defense references), test-driven development (with good-test reference), verification-before-completion, receiving-code-review, and writing-skills.
   - Preserve upstream red flags, rationalization tables, stop/escalation logic, and examples unless a source-recorded apple-pi action translation is needed.
   - Define the exact criterion categories for which RED/GREEN is feasible and the alternate evidence required elsewhere. Preserve the prohibition on weakening tests while protecting pre-existing/unowned work.
   - Add root-session skill-behavior tests: no typed agent proxy; each changed behavior gets five fresh sandbox baseline/treatment repetitions and manual classification.

5. **Build the authentic apple-pi execution and review paths.**
   - Extend `ledger-execute-task` with an explicit route decision: typed Agent SDD for resumable per-WI collaboration, Ralph for bounded sequential fresh increments, and `pi_exec` for genuinely independent bounded fan-out.
   - Translate upstream implementer/task-reviewer/re-reviewer prompts into Agent invocation guidance and `pi-review` task-gate/fix-scoped/final-review templates. Keep reports as unverified input, retain verifier decisions, and preserve coverage-gap output.
   - Preserve status routing, context handoff, preflight interface review, fix escalation, and final review while recording only Ledger state. Significant unresolved findings block rather than become a controller “ruling.”

6. **Restore explicit isolation and finishing semantics.**
   - Add adapted worktree and finishing skills that preserve detection, consent, baseline verification, options, exact destructive confirmation, ownership-aware cleanup, and rationalization counters.
   - Translate all Git/forge effects into operator-authorized actions. No skill may automatically change `.gitignore`, commit, push, merge, open a PR, force-delete, or dispose of unowned work.

7. **Port the visual companion as its own bounded increment.**
   - Implement only after the preceding textual workflow has a functioning root entry and after focused security/license/source inspection.
   - Preserve opt-in, authenticated local interactions, terminal-primary feedback, owner-bound cleanup, durable selected content, and restart/failure behavior; replace upstream branding/telemetry and `.superpowers` storage with apple-pi-owned equivalents.

8. **Close the package-level workflow.**
   - Update user-facing and maintainer docs, package loader assertions, and package contents.
   - Execute root happy-path and failure-path evaluations, focused unit/integration tests, full repository validation, independent `pi-review`, attribution review, and pack inspection.
   - Record verified criterion evidence, residual limits, and distillation. Present integration choices; do not self-authorize Git/forge actions.

## Acceptance And Backpressure

| Criterion | Proof before advancement |
| --- | --- |
| AC-001 | Exact source matrix covers all 14 skills, material role prompts/helpers/bootstrap surfaces, source revision, disposition, local owner, state translation, and attribution status. |
| AC-002 | Clean root session demonstrates automatic workflow discovery and the complete documented happy-path transitions; package/extension tests prove root-only, exact-once behavior. |
| AC-003 | Tests and review show every referenced action maps to real apple-pi APIs; repository scan finds no `.superpowers` state, generic `Task`/`TodoWrite`, duplicate progress system, or self-authorizing controller. |
| AC-004 | Five fresh disposable-root Git-sandbox repetitions per changed behavior include the complete prompt, environment, trace/final result, manual `meets`/`partial`/`misses` classification, and treatment comparison. |
| AC-005 | Focused checks pass while iterating; before closure run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run pack:check`, appropriate root workflow evaluations, and independent `pi-review`. |

A failed bootstrap, missing skill/action mapping, rejected worker result, unresolved material review finding, inconclusive evaluation, stale evidence, test failure, or unexplained package-surface difference blocks the affected increment. It does not authorize a smaller silent implementation.

## Risks And Failure Modes

- **Prompt bloat or duplicate activation:** bootstrap only routes to on-demand skills, has a marker/idempotency test, and must not be copied into children/workers.
- **False textual fidelity:** exact source anchors and notice coverage are required; adapt actions/authority without silently deleting behavior.
- **Second state machine:** every imported artifact names its Ledger consumer before creation. Remove rather than coexist with superseded workflow text.
- **Invented generic API:** each instruction is checked against actual `Agent`, `pi_exec`, Ralph, `pi-review`, Ledger, and core-tool contracts.
- **Unsafe Git/forge automation:** preserving Superpowers finishing language does not grant external/destructive authority. Explicit human selection and exact discard confirmation remain required.
- **Invalid skill evaluation:** typed specialist output is never evidence for root behavior; use fresh disposable root Pi sessions in initialized Git sandboxes.
- **Visual companion expansion:** isolate it until security, lifecycle, package, and owner-state evidence supports a minimal coherent port.

## Integration Points

- Root `before_agent_start` prompt assembly must compose deterministically with Ledger, Agent roster, Advisor, and notification hooks.
- Interactive Agent children and `pi_exec` workers retain their explicit extension loads; the root workflow extension must not leak into either.
- New skill descriptions must remain precise so Pi discovers them without loading unrelated content.
- Ralph and `pi-review` retain their existing controller boundaries; SDD behavior adapts their composition rather than adding a parallel runtime.
- Package loader and `files` allowlist must include every new source, helper, skill, document, test, and notice.

## Rollback Or Recovery

Each phase is independently reviewable. If a phase fails its source, behavior, package, or independent-review gate, retain the previous coherent current workflow and revert only changes authored for that phase. Do not leave an inactive root bootstrap, half-discoverable skills, orphaned artifacts, compatibility copies, or test bypasses. The Ledger task records failure evidence and next ownership.

## Related Records

- `.ledger/202608202254-strengthen-ledger-workflow/decisions/fusion-scope.md`
- `.ledger/202608202254-strengthen-ledger-workflow/specs/apple-pie-superpowers-fusion.md`
- `.ledger/202608202254-strengthen-ledger-workflow/research/fusion-traceability.md`
- `.ledger/202608202254-strengthen-ledger-workflow/research/baseline-evaluation-design.md`

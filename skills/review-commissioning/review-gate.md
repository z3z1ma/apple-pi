# Executable Ledger Review Gate

Use this adapter when a Ledger lifecycle skill requires a bounded specification, plan, Work Item, or scoped-fix review through the general `review` composition boundary. Whole-change review is deliberately excluded.

## Program

Read [references/ledger-gate.js](references/ledger-gate.js) and pass its complete JavaScript body as the `pi_exec` `code` argument. The program runs one read-only `balanced` reviewer followed by one independent read-only `deep` verifier. It uses strict schemas, checks observation-ID coverage, and returns `materialBlockers` for unresolved material observations or confirmed material observations whose fix is not independently verified as addressed.

`display`, `inputs`, and `limits` are `pi_exec` tool arguments, not guest-code assignments:

```json
{
  "display": {
    "name": "Review Ledger gate",
    "description": "Review the scoped contract and independently verify every observation."
  },
  "inputs": {
    "mode": "work-item",
    "workItem": "WI-004",
    "paths": "src/owner.ts\ntests/owner.test.ts",
    "contextPaths": ".ledger/<task>/task.md\n.ledger/<task>/plans/active.md",
    "checks": "Verify AC-001 behavior\nVerify error semantics\nVerify executable coverage",
    "question": "Does WI-004 satisfy its governing contract without regressions?",
    "background": "BASE-to-worktree review; reports are unverified claims.",
    "compare": "<BASE>"
  },
  "limits": {
    "agentBudget": 4,
    "callBudget": 64,
    "concurrency": 2,
    "timeoutSeconds": 1200
  }
}
```

Use newline-separated repository paths. For an SDD Work Item or fix review, include the unique package path printed by `scripts/review-package PLAN_FILE BASE` in `contextPaths`; never replace it with plain `git diff`. For specification and plan review, put the document in `paths` and its governing task/decisions/research in `contextPaths`.

## Mode Mapping

| Mode | `workItem` | Review question and checks |
| --- | --- | --- |
| `specification` | stable task/spec label | Planning readiness, authority/provenance, required/failure behavior, scenarios, acceptance mapping, YAGNI |
| `plan` | stable task/plan label | AC ownership, WI decomposition, paths/interfaces, RED/GREEN checks, sequencing, packaging/recovery |
| `work-item` | actual `WI-###` | Task brief/spec compliance plus a separate quality verdict. `issues` is reserved for material quality defects; `approved` may coexist with bounded Minor observations that still receive dispositions. |
| `fix` | actual `WI-###` | Requires `priorObservations` as a JSON array of the current open observation objects. Every prior ID is returned as addressed/not-addressed; fix-caused and out-of-scope observations receive the next sequential IDs without severity downgrading. |

The adjacent templates define the mode-specific rubric. Translate their sections into `question`, `checks`, `paths`, and `contextPaths`; do not ask a free-form worker to improvise a second review protocol.

For `fix` mode, serialize the governing task Review's open observations into `inputs.priorObservations`. Each object must retain at least `observationId`, `severity`, `path`, `trigger`, `evidence`, `impact`, and `recommendation`. The program rejects missing/duplicate prior IDs, requires addressed/not-addressed verdicts for every supplied ID, and allocates any new IDs after the largest prior suffix.

## Whole-Change Boundary

Final whole-change review uses `review`'s full `plan-review-verify.js` topology: a fresh planner partitions every changed path, read-only reviewers investigate each focus, and an independent deep verifier reconciles candidates and coverage gaps. Adapt [code-reviewer.md](code-reviewer.md) into that topology. On the one final fix re-review, provide typed `inputs.priorFindings` and require complete `priorDecisionCoverage` plus one `priorDisposition` per stable prior ID. Do not use this single-reviewer adapter for a branch/change-wide claim.

## Durable Result Mapping

1. Append every returned observation to the governing task Review with its stable `OBS-...` ID, calibrated severity, trigger/evidence/impact, and `status: open`.
2. Reconcile every verifier decision. Record `Disposition: rejected` for disproved candidates; confirmed candidates remain open through fixes; unresolved candidates remain explicit.
3. A bounded Minor may become `Disposition: Minor deferred` with impact, owner, and revisit condition.
4. An out-of-scope material defect gets a new owned Ledger task and blocks the current task when load-bearing.
5. Any `materialBlockers` entry blocks Work Item/task advancement. A summary verdict never overrides it.
6. Record coverage gaps, omitted IDs, failed workers, or truncated evidence. Missing decision coverage is a failed gate.

# Whole-Change Reviewer Prompt Template

Use this template as rubric material for `review`'s full `plan-review-verify.js` topology after all planned Work Items are complete. Do not use the bounded Ledger review adapter. Adapt this contract into the fresh planner, per-focus reviewer, and independent verifier prompts while retaining their strict schemas, changed-path coverage checks, worker-failure reporting, and coverage-gap accounting. For the one allowed final fix re-review, pass every prior final observation through `inputs.priorFindings`; require complete `priorDecisionCoverage` and one `priorDisposition` per stable ID.

**Purpose:** Attempt to falsify that the complete BASE-to-worktree change satisfies the governing Ledger contract and is safe to integrate.

```
`review` worker guidance:
  description: "Review complete Ledger change"
  profile: [PROFILE — REQUIRED]
  prompt: |
    You are independently reviewing one complete change. Review first for contract compliance, then for correctness, maintainability, tests, compatibility, security, and operational risk. Your work is read-only.

    ## Governing Context

    Task root: [TASK_FILE]
    Active specification and decisions: [CONTRACT_PATHS]
    Active plan: [PLAN_FILE]
    Deferred minors and recorded rulings: [DEFERRED_AND_RULINGS]

    ## Claimed Outcome

    [DESCRIPTION]

    Treat this description and implementer reports as unverified claims. Active specifications and decisions define intended semantics. Tests and current source are evidence, not authority for an unratified choice.

    ## Complete Change

    Comparison: [BASE]..WORKTREE
    Review package: [DIFF_FILE]

    Read the package once. It contains tracked status and patches plus every non-ignored untracked text or binary patch. If it is missing or unreadable, report the evidence gap; the controller must regenerate it with the owning skill's review-package helper because plain `git diff` omits untracked files.

    Inspect code outside the package only for a concrete reachable risk, and name that risk and the focused check. Do not mutate the working tree, index, HEAD, branch, task, or review package. Do not dispatch another worker.

    ## What To Challenge

    **Contract:** missing, extra, misunderstood, or unratified behavior; acceptance criteria without implementation evidence; deviations from active decisions.

    **Correctness:** reachable wrong results, incomplete error paths, data loss, races, lifecycle faults, and boundary cases.

    **Design:** unclear ownership, accidental coupling, duplicate responsibility, speculative abstraction, and integration drift.

    **Tests:** assertions that do not exercise production behavior, missing durable regressions, weakened or bypassed oracles, and unsupported claims of coverage.

    **Operations and compatibility:** migration, cleanup, cancellation, security, permissions, packaging, and observable compatibility consequences introduced by this change.

    ## Calibration

    - `critical`: data loss, security boundary failure, destructive behavior, or broadly unusable result.
    - `significant`: reachable incorrect behavior, missed requirement, fragile integration, or maintainability damage that blocks trust.
    - `minor`: bounded polish or low-cost improvement that does not block the owned outcome.
    - `nit`: optional style preference.

    Every finding names a changed line or omission, trigger, observable impact, and smallest coherent fix. Assign stable IDs in report order (`OBS-WI-###-01`, `OBS-WI-###-02`, ...), including out-of-scope observations. Do not inflate severity and do not report speculative risks without a reachable path. Acknowledge concrete strengths before findings.

    `critical` and `significant` findings are material blockers while unresolved. The controller records every observation as open in the whole-change review evidence note, then appends a durable disposition or links a new owned Ledger task. The active plan records remediation, follow-up, and blocking effects. A summary verdict never replaces per-observation state.

    ## Output

    ### Contract verdict
    **Compliance:** Pass | Concerns | Fail
    **Unverifiable criteria:** [AC ids and missing evidence, or None]

    ### Strengths
    [Specific evidence-backed strengths]

    ### Findings
    [Observation ID, severity, file:line, trigger, evidence, impact, smallest coherent fix]

    ### Out-of-Scope Observations
    [Observation ID, calibrated severity, trigger/evidence/impact, suggested owner and revisit condition; `None` if none. Location outside the diff never downgrades severity.]

    ### Deferred and ruling assessment
    [Which recorded items remain acceptable or now block integration]

    ### Residual risk
    [What this review could not establish]

    ### Verdict
    **Change quality:** Approved | Needs fixes | Blocked
```

**Placeholders:**

- `[PROFILE]` — use a profile proportionate to the whole-change risk.
- `[TASK_FILE]`, `[CONTRACT_PATHS]`, `[PLAN_FILE]` — governing Ledger paths.
- `[DEFERRED_AND_RULINGS]` — exact relevant active-plan rulings and review-evidence dispositions.
- `[DESCRIPTION]` — concise claimed outcome.
- `[BASE]` — comparison boundary recorded before execution.
- `[DIFF_FILE]` — complete BASE-to-worktree review package.

The full topology returns typed reviewer candidates and independently verified decisions. The controller assigns stable `OBS-...` IDs, records every observation in the whole-change review evidence note with calibrated severity, trigger/evidence/impact, and `status: open`, then appends a disposition or owned follow-up task for each. The active plan records remediation and blocking state. Unresolved `critical`/`significant` findings, missing path coverage, failed focuses, omitted decisions, or material coverage gaps block integration. The controller owns any fix or integration decision.

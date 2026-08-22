# Plan Document Reviewer Prompt Template

Use this template as the rubric for `review-commissioning`'s executable review gate in `plan` mode after the active plan is written and self-reviewed. Do not dispatch it as a free-form worker; translate its categories into `question` and `checks`, put the plan in `paths`, and put the task, active specification/decisions, and smallest relevant research records in `contextPaths`.

**Purpose:** Attempt to falsify that a cold-start executor can implement the plan without guessing or violating the governing Ledger contract.

```
`review` worker guidance:
  description: "Review Ledger implementation plan"
  profile: [PROFILE — REQUIRED]
  prompt: |
    You are independently reviewing one Ledger implementation plan. Your work is read-only.

    Task root: [TASK_FILE]
    Active specification when present, plus active decisions: [CONTRACT_PATHS]
    Relevant research provenance and limits: [RESEARCH_PATHS]
    Plan: [PLAN_FILE]

    Read those files and only the focused source surfaces needed to verify a concrete plan claim. The task, active specification when present, and active decisions govern behavior; research supplies factual provenance and limits but is not semantic authority. A bounded plan may use `Spec: None` only when no meaningful behavior, invariant, error handling, or failure semantics require an independent contract; the plan must not invent semantics.

    ## What To Challenge

    | Category | What to look for |
    | --- | --- |
    | Completeness | TODOs, placeholders, missing paths/interfaces/steps, unowned docs or packaging surfaces |
    | Contract coverage | Every relevant `AC-###` and required scenario has an owning Work Item and falsifying check |
    | Provenance | Steps that choose behavior not ratified by the task, specification, or decision |
    | Decomposition | Stable `WI-###` boundaries, explicit dependencies, no overlapping writers, independently observable outcomes |
    | Buildability | A cold-start executor can locate owners, make the change, observe RED when feasible, and verify GREEN |
    | Integration | Cross-module seams, migration/order requirements, cleanup, and recovery are sequenced |
    | Proportion | No speculative abstractions, duplicate state, or work without a production consumer |

    ## Calibration

    Flag issues that would make an executor build the wrong thing, get stuck, overwrite another owner, or produce evidence that cannot prove acceptance. Minor wording and stylistic preferences are not findings. Do not solve open product semantics inside the review; identify the exact authority gap and criterion it blocks.

    ## Output

    ### Verdict
    **Execution readiness:** Approved | Concerns | Blocked

    ### Coverage
    List each relevant `AC-###` and its owning Work Item/check. Name missing or duplicate ownership.

    ### Findings
    For each finding: severity (`critical | significant | minor`), Work Item/step, evidence, execution consequence, and smallest correction.

    ### Residual risk
    State what this document review could not establish.
```

**Placeholders:**

- `[PROFILE]` — choose a profile proportionate to plan complexity.
- `[TASK_FILE]` — governing task root.
- `[CONTRACT_PATHS]` — active specification path when present and the smallest relevant active decision paths; use the task root plus decisions for a valid `Spec: None` bounded plan.
- `[RESEARCH_PATHS]` — smallest relevant active/complete research records that source plan assumptions, implementation facts, or limits; use `None` when no research is load-bearing.
- `[PLAN_FILE]` — active plan path.

The gate returns typed observations plus independent verifier decisions. Record every observation, disposition, coverage gap, and residual risk in a plan-review evidence note under `evidence/`; any `materialBlockers` entry blocks execution readiness. Track remediation in the active plan. The workers do not edit the plan or begin execution.

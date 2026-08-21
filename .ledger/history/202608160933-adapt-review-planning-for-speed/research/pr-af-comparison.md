Status: done
Created: 2026-08-16
Updated: 2026-08-16

# Research PR-AF's adaptive review design against apple-pi

## Question Or Hypothesis

Which PR-AF design elements improve apple-pi's semantic, fresh-context review quality while preserving its sealed-input safety invariants and reducing, rather than expanding, wall-clock latency?

**Falsifiable hypothesis:** a single apple-pi planner can retain complete selected-item coverage while generating cohesive, possibly overlapping groups and a separate bounded, overlapping focus-assignment layer; dispatching and verifying those focuses as a pipelined global-concurrency work graph will capture PR-AF's most useful dynamic-planning property without adding its slow multi-phase pipeline.

## Motivation

The user wants review chunks that are semantic or structural, fresh-context parallel review, dynamically generated review focuses based on each diff, and a sustainable fast loop. The current controller already satisfies most safety and coverage requirements, but its group is simultaneously a coverage unit and its only review focus, and it waits for every reviewer before it starts any verifier.

The answer changes the task: if PR-AF's extra phases are necessary for dynamic focus quality, apple-pi needs a larger pipeline; if a richer planner contract is sufficient, the smallest coherent change is a plan-schema and controller scheduling evolution.

## Sources And Methods

- Local source at repository `HEAD` (`4edd07e` observed 2026-08-16): `components/review/src/{types,roles,work-graph,controller,policy}.ts`, packaged review role skills, review tests, and `docs/review.md`.
  - Method: traced plan schema, prompt construction, work-graph validation, controller stage order, receipt fields, and existing focused tests.
- PR-AF repository `https://github.com/Agent-Field/pr-af`, shallow-cloned 2026-08-16 at revision `8593130884ef718db9709c029fa7906ca00d2efd`.
  - Method: read repository README and architecture document, plus maintained Go pipeline/schema/prompt/orchestration sources under `go/internal/`.
- No PR-AF models, services, GitHub integration, benchmark, or timing claims were executed or independently reproduced.

## Findings

### Observations

1. **apple-pi already owns the required safety baseline.** Its planner historically assigned every selected item exactly once to `ReviewGroup.itemIds`; `compileReviewWorkGraph` still rejects missing, invented, or internally duplicated IDs and unsafe context paths. After the live planner failure on this task, group overlap is an accepted cohesive-unit property, while selected-item completeness and per-group child-focus coverage remain mandatory. Planner, reviewer, and verifier use controller-supplied typed terminating tools. Reviewers and verifiers are new read-only sessions; findings must anchor a changed focus path; receivers preserve a user-local receipt. (`components/review/src/{types,roles,work-graph,controller}.ts`.)

2. **apple-pi's review group currently conflates coverage and investigation.** `ReviewGroup` has `title`, `objective`, `itemIds`, `contextPaths`, `tier`, and `rationale`; `reviewerPrompt` renders one objective/rationale for the whole group. The planner skill directs a semantic partition but has no schema for multiple independently reviewable concerns over the same selected files. (`components/review/src/types.ts`, `roles.ts`, `skills/review-planner/SKILL.md`.)

3. **apple-pi validates after a stage barrier.** `ReviewController.reviewGroups()` awaits all group reviewers; only then does `verifyGroups()` begin. Each stage applies its own concurrency limit, so reviewer completion cannot start independent verification while another review group is still running. (`components/review/src/controller.ts`.)

4. **PR-AF's valuable planning abstraction is a focus, not merely a file group.** Its maintained schema defines `ReviewDimension` with a dynamic `review_prompt`, `target_files`, `context_files`, and priority. The three semantic, mechanical, and systemic meta-selectors independently create dimensions from intake, diff anatomy, repository inspection, and explicit lens instructions; dimensions are then deduplicated by target set and dispatched to one generic reviewer role. (`go/internal/schemas/pipeline.go`, `go/internal/prompts/meta.go`, `go/internal/orch/phases.go`.)

5. **PR-AF's dynamic prompts make a useful quality requirement explicit.** Each selector instructs the planner to investigate repository code, formulate a specific question rather than a generic category, name files/callers/line ranges and verification steps, and return zero dimensions when its lens adds no risk. These requirements can be expressed through apple-pi's planner typed result contract without adding three selector roles. (`go/internal/prompts/meta.go`.)

6. **PR-AF has incompatible or redundant mechanisms.** Intake, LLM anatomy, three meta-selectors, coverage-loop gap reviewers, child reviewers, AI-authorship classification, scoring, GitHub publication, and external persistence have no required apple-pi consumer. apple-pi already has stronger selected-item coverage, path authority, and finding anchoring. Adding those phases would duplicate responsibility and expand latency.

7. **PR-AF's published speed target contradicts this task.** Its README says the comprehensive pipeline typically takes 35–50 minutes and positions it as a final CI/CD audit rather than an interactive loop. This is evidence about PR-AF's stated design, not an independently verified benchmark or latency measurement.

8. **The maintained PR-AF source does not fully match its streaming description.** In `go/internal/orch/phases.go`, review batches are sent over a channel, but `runReviewLayer` first ranges until that channel closes and only then extracts evidence, verifies, adversarially reviews, and performs compound analysis. It therefore does not demonstrate true overlapping finding verification with ongoing review workers. The local controller should not copy the claimed streaming pipeline without separate evidence.

### Inferences

- The compatible core is **one planner-generated, bounded focus layer**, not PR-AF's phase count. Groups should remain cohesive review units and may share selected items. Focuses should be separate assignments that may overlap selected items when distinct risks require independent fresh-context investigation, and each group's focuses must cover that group's items.
- Every selected item needs at least one focus. That preserves apple-pi's meaningful coverage denominator even if no defect is found. A focus must be non-empty, path-safe, tied to selected items, bounded by controller policy, and carry an actionable question/checks plus context paths and tier.
- A controller-owned global role scheduler can run a verifier as soon as its focus reviewer submits findings, while another focus review continues. This is a direct wall-clock improvement over the current barrier and does not need a queue, new agent role, or background phase.
- Keep verifier execution conditional on a finding-bearing focus, as today. A no-finding focus can mark its assigned items complete after its typed reviewer result; a failed reviewer/verifier must retain incomplete coverage exactly as today.
- No external source establishes that semantic/mechanical/systemic selector roles, reviewer child spawning, or cross-finding compound analysis improve apple-pi quality enough to justify their latency and complexity.

## Conclusions

**Confidence: high** that apple-pi should adopt separate bounded overlapping dynamic focuses and focus-level review/verification pipelining; this follows directly from source comparison and the stated product constraints.

**Confidence: high** that copying PR-AF's full adaptive pipeline is inappropriate for this task: it duplicates current guarantees, lacks a local runtime consumer, and conflicts with the fast-loop objective.

**Confidence: medium** that explicit planner requirements for concrete questions, repository-derived evidence context, and no padding will improve focus quality; the requirement is sound and PR-AF uses it, but no local before/after quality corpus was evaluated.

## Limits

- No controlled evaluation compared focus quality, finding recall, false-positive rate, tokens, cost, or latency before and after the proposed design.
- PR-AF is an external project whose architecture documentation and current source may evolve after revision `8593130`.
- The correct maximum focus count, global concurrency behavior, receipt schema, and exact focus-to-group relationship need an apple-pi specification before implementation.

## Related Records

- `docs/review.md`
- `components/review/src/controller.ts`
- `https://github.com/Agent-Field/pr-af/tree/8593130884ef718db9709c029fa7906ca00d2efd`

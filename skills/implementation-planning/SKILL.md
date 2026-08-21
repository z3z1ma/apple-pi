---
name: implementation-planning
description: "Use when a shaped Ledger task has an approved specification or settled requirements for multi-step work, before touching code."
---

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each Work Item, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized Work Items. DRY. YAGNI. TDD. Frequent verified increments; the operator owns commits.

Assume they are a skilled developer, but know almost nothing about our toolset or problem domain. Assume they don't know good test design very well.

**Announce at start:** "I'm using the implementation-planning skill to create the implementation plan."

**Context:** If working in an isolated worktree, it should have been created via the `workspace-isolation` skill at execution time.

## Ledger State: Shaping To Orchestration

A plan is the cold-start bridge from ratified behavior to bounded execution. It must preserve why each Work Item exists, its dependencies and integration points, the exact source surfaces it owns, the failure that proves RED, and the observation that can prove done. Plans may choose reversible implementation mechanics; they may not turn examples, current accidents, or technical convenience into product authority. If a Work Item still requires an execution-changing semantic choice, return it to `task-shaping` instead of hiding the choice in implementation steps.

## Ledger Authority

Find the owning task through `.ledger/INDEX.md`, live task roots, and `.ledger/history/INDEX.md`. Extend the existing owner when its Scope and Acceptance Criteria cover the outcome. For new non-trivial work, use `ledger_add`, then complete task-shaping before planning.

Read `task.md`, active specifications, decisions, research, and relevant source. Dependencies resolve first at `.ledger/<task-id>/task.md`, then `.ledger/history/<task-id>/task.md`, and must be `done`. Planning begins when Scope and Non-goals form a perimeter, stable `AC-###` criteria cover success and failure behavior, execution-changing assumptions are sourced or operator-ratified, and Blockers is honestly `None.`.

Planning maps settled behavior to implementation. It does not settle product semantics with convenient technical defaults.

**Save plans to:** `.ledger/<task-id>/plans/YYYY-MM-DD-<feature-name>.md` and link the active plan from `task.md`.

## Scope Check

If the spec covers multiple independent subsystems, it should have been broken into sub-project specs during task-shaping. If it wasn't, suggest breaking this into separate plans — one per subsystem. Each plan should produce working, testable software on its own.

## File Structure

Before defining Work Items, map out which files will be created or modified and what each one is responsible for. This is where decomposition decisions get locked in.

- Design units with clear boundaries and well-defined interfaces. Each file should have one clear responsibility.
- You reason best about code you can hold in context at once, and your edits are more reliable when files are focused. Prefer smaller, focused files over large ones that do too much.
- Files that change together should live together. Split by responsibility, not by technical layer.
- In existing codebases, follow established patterns. If the codebase uses large files, don't unilaterally restructure - but if a file you're modifying has grown unwieldy, including a split in the plan is reasonable.

This structure informs the task decomposition. Each Work Item should produce self-contained changes that make sense independently.

## Work-Item Right-Sizing

A Work Item is the smallest unit that carries its own test cycle and is worth a
fresh reviewer's gate. When drawing Work-Item boundaries: fold setup,
configuration, scaffolding, and documentation steps into the Work Item whose
deliverable needs them; split only where a reviewer could meaningfully
reject one Work Item while approving its neighbor. Each Work Item ends with an
independently testable deliverable.

## Bite-Sized Work-Item Granularity

**Each step is one action (2-5 minutes):**
- "Write the failing test" - step
- "Run it to make sure it fails" - step
- "Implement the minimal code to make the test pass" - step
- "Run the tests and make sure they pass" - step
- "Record the verified increment in Ledger" - step

## Plan Document Header

**Every plan MUST start with this header:**

```markdown
Status: active
Created: YYYY-MM-DD
Updated: YYYY-MM-DD

# [Feature Name] Implementation Plan

> **For executors:** REQUIRED SUB-SKILL: Use work-item-orchestration (recommended) or plan-execution to implement this plan Work-Item by Work-Item. `task.md` owns the canonical `WI-###` checklist.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

**Spec:** [path to the spec/design doc this plan implements — the plan
argues from the spec, so the spec travels with it; executors read both]

## Global Constraints

[The spec's project-wide requirements — version floors, dependency limits,
naming and copy rules, platform requirements — one line each, with exact
values copied verbatim from the spec. Every Work Item's requirements implicitly
include this section.]

---
```

## Work-Item Structure

````markdown
### WI-###: [Component Name]

**Files:**
- Create: `exact/path/to/file.py`
- Modify: `exact/path/to/existing.py:123-145`
- Test: `tests/exact/path/to/test.py`

**Interfaces:**
- Consumes: [what this task uses from earlier Work Items — exact signatures]
- Produces: [what later Work Items rely on — exact function names, parameter
  and return types. A task's implementer sees only their own task; this
  block is how they learn the names and types neighboring Work Items use.]

**Step 1: Write the failing test**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

**Step 2: Run test to verify it fails**

Run: `pytest tests/path/test.py::test_name -v`
Expected: FAIL with "function not defined"

**Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

**Step 4: Run test to verify it passes**

Run: `pytest tests/path/test.py::test_name -v`
Expected: PASS

**Step 5: Record the verified increment**

Update the governing Ledger Work Item, Evidence, and Journal with the observed RED/GREEN results. The operator decides whether and when to commit.
````

## No Placeholders

Every step must contain the actual content an engineer needs. These are **plan failures** — never write them:
- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
- "Write tests for the above" (without actual test code)
- "Similar to WI-###" (repeat the code — the engineer may be reading Work Items out of order)
- Steps that describe what to do without showing how (code blocks required for code steps)
- References to types, functions, or methods not defined in any task

## Self-Review

After writing the complete plan, look at the spec with fresh eyes and check the plan against it. This is a checklist you run yourself — not a subagent dispatch.

**1. Spec coverage:** Skim each section/requirement in the spec. Can you point to a task that implements it? List any gaps.

**2. Placeholder scan:** Search your plan for red flags — any of the patterns from the "No Placeholders" section above. Fix them.

**3. Type consistency:** Do the types, method signatures, and property names you used in later Work Items match what you defined in earlier Work Items? A function called `clearLayers()` in WI-003 but `clearFullLayers()` in WI-007 is a bug.

If you find issues, fix them inline. If you find a specification requirement with no Work Item, add the Work Item.

## Independent Plan Review

Load `review-commissioning` and use its executable review gate in `plan` mode. Translate [plan-document-reviewer-prompt.md](plan-document-reviewer-prompt.md) into `question`, `checks`, plan `paths`, and governing `contextPaths`; pass `references/ledger-gate.js` from that skill as the `pi_exec` program. Record every typed observation and verified disposition in `task.md` Review. Resolve every critical or significant finding and re-run the bounded gate before offering execution. A remaining execution-changing authority gap returns to `task-shaping`; it is not a planning default.

## Execution Handoff

After saving the plan, offer execution choice:

**"Plan complete and saved to `.ledger/<task-id>/plans/<filename>.md`. Two execution options:**

**1. Agent-Driven (recommended)** - I dispatch a fresh typed `Agent` implementer per Work Item and run `review` between Work Items

**2. Inline Execution** - Execute Work Items in this session using plan-execution, batch execution with checkpoints

**Which approach?"**

**If Subagent-Driven chosen:**
- **REQUIRED SUB-SKILL:** Use work-item-orchestration
- Fresh typed implementer per Work Item + independent review

**If Inline Execution chosen:**
- **REQUIRED SUB-SKILL:** Use plan-execution
- Batch execution with checkpoints for review

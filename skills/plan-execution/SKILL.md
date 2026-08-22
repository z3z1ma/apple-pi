---
name: plan-execution
description: "Use when you have an authorized Ledger implementation plan to execute sequentially with review checkpoints."
---

# Executing Plans

## Overview

Load the governing Ledger task and plan, review critically, execute every Work Item, maintain observed evidence and review state, and report when complete.

**Announce at start:** "I'm using the plan-execution skill to implement this plan."

## Ledger State: Execution

Own one Work Item or acceptance gap at a time. The plan supplies commander's intent; the task, active specifications when present, and decisions supply semantic authority. Keep Work Item state, progress, replanning, cancellation, and blocking conditions in the active plan; write observations with commands and limits to linked evidence notes. Pull execution back to shaping when new ambiguity could change behavior or acceptance. Out-of-scope findings need an existing owner, a new bounded task, or a substantive no-action rationale; they do not silently expand the current task.

## The Process

### Step 1: Load and Review Plan
1. Confirm operator authorization for the named task.
2. Read `.ledger/INDEX.md`, `task.md`, the active plan, active specs and decisions, and relevant repository authority.
3. Enumerate the selected Work Item's linked implementation, test, and review evidence; read open dispositions, prior limits, and deferred blockers, then reconcile them with current repository state before resuming or activating work.
4. Resolve dependencies and verify that no referenced research, decision need, plan, or dependency still blocks the selected Work Item.
5. Ensure an isolated workspace when required: use `workspace-isolation` to create one or verify the existing one.
6. Review the plan critically for stale source assumptions, conflicting interfaces, missing failure behavior, and unowned side effects.
7. Raise material concerns before starting; when ready, set task Status to `active`, confirm the `WI-###` entry in the active plan, and set that Work Item to `active`.

### Step 2: Execute Work Items

For each Work Item:
1. Set the Work Item to `active` in the plan; record any changed execution approach under its `Replanning` field.
2. Load every applicable process skill from the available-skills catalog.
3. Follow each plan step exactly; use `test-first-development` for testable behavior.
4. Run the specified verification and inspect the bounded diff.
5. Use `review-commissioning` when the Work Item has a review gate.
6. Mark the plan's `WI-###` state `complete` only after implementation, checks, and review pass.
7. Reconcile recovered prior evidence and newly observed commands/results, mapped `AC-###` criteria, limits, review findings, and dispositions in the Work Item's evidence links; keep remediation progress in the plan.

A complete Work Item is implementation progress; Acceptance Criteria require their own observed evidence.

### Step 3: Complete Development

After all tasks complete and verified:
- Announce: "I'm using the task-closure skill to complete this work."
- **REQUIRED SUB-SKILL:** Use task-closure
- Follow that skill to verify tests, present options, execute choice

## When to Stop and Ask for Help

**STOP executing immediately when:**
- Hit a blocker (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly

**Ask for clarification rather than guessing.**

## When to Revisit Earlier Steps

**Return to Review (Step 1) when:**
- Partner updates the plan based on your feedback
- Fundamental approach needs rethinking

**Don't force through blockers** - stop and ask.

## Remember
- Review plan critically first
- Follow plan steps exactly
- Don't skip verifications
- Reference skills when plan says to
- Stop when blocked, don't guess
- Use `workspace-isolation` when isolation is required; the operator owns branch and worktree creation

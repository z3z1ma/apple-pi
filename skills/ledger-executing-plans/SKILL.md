---
name: ledger-executing-plans
description: "Use when you have an authorized Ledger implementation plan to execute sequentially with review checkpoints."
---

# Executing Plans

## Overview

Load the governing Ledger task and plan, review critically, execute every Work Item, maintain observed evidence and review state, and report when complete.

**Announce at start:** "I'm using the ledger-executing-plans skill to implement this plan."

## Ledger State: Execution

Own one Work Item or acceptance gap at a time. The plan supplies commander's intent; active specifications and decisions supply semantic authority. Journal material progress and discoveries when observed, keep evidence tied to commands and limits, and pull execution back to shaping when new ambiguity could change behavior or acceptance. Out-of-scope findings need an existing owner, a new bounded task, or a substantive no-action rationale; they do not silently expand the current task.

## The Process

### Step 1: Load and Review Plan
1. Confirm operator authorization for the named task.
2. Read `.ledger/INDEX.md`, `task.md`, the active plan, active specs and decisions, and relevant repository authority.
3. Resolve dependencies and verify Blockers is honestly `None.`.
4. Ensure an isolated workspace when required: use `ledger-using-git-worktrees` to create one or verify the existing one.
5. Review the plan critically for stale source assumptions, conflicting interfaces, missing failure behavior, and unowned side effects.
6. Raise material concerns before starting; when ready, set Status to `active`, confirm the `WI-###` rows in `task.md`, and record the execution start in Journal.

### Step 2: Execute Work Items

For each Work Item:
1. Record the Work Item as started in Journal.
2. Load every applicable process skill from the available-skills catalog.
3. Follow each plan step exactly; use `ledger-test-driven-development` for testable behavior.
4. Run the specified verification and inspect the bounded diff.
5. Use `ledger-requesting-code-review` when the Work Item has a review gate.
6. Mark the `WI-###` row complete only after implementation, checks, and review pass.
7. Record commands, results, mapped `AC-###` criteria, limits, confirmed findings, and dispositions in Evidence and Review.

A complete Work Item is implementation progress; Acceptance Criteria require their own observed evidence.

### Step 3: Complete Development

After all tasks complete and verified:
- Announce: "I'm using the ledger-finishing-a-development-branch skill to complete this work."
- **REQUIRED SUB-SKILL:** Use ledger-finishing-a-development-branch
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
- Use `ledger-using-git-worktrees` when isolation is required; the operator owns branch and worktree creation

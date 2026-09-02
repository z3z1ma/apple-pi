# Diagnosing bugs

Source: `mattpocock/skills` at `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`

Status: approved; implementation and targeted validation complete

## Target

Preserve upstream `diagnosing-bugs` as a gated six-phase discipline for hard defects and performance regressions: build one tight red-capable loop, reproduce and minimise the exact symptom, rank falsifiable hypotheses, instrument one prediction at a time, fix with a correct-seam regression test when authorized, and clean up before returning.

## Operator decisions

1. Retain the broad upstream model-invocation trigger for reports that something is broken, throwing, failing, or slow, despite the upstream documentation's known over-activation reports.
2. Replace the agent-run interactive shell template with a root-orchestrated HITL protocol: numbered operator actions, named redacted observations, and an explicit verdict predicate. Ordinary conversation carries open observations; `ask_user_question` is an optional adapter only for bounded structured choices. Interactive scripts are operator-run outside agent `bash`; any Pi-run helper is non-interactive.
3. Follow request intent for mutation authority: diagnosis/explanation stops with the confirmed cause and proposed fix; a fix/debug request permits the smallest local causal change. Commits and external effects remain separately authorized.
4. Add no new native HITL tool now. Use the skill-level named protocol with conversation, the existing bounded questionnaire where suitable, parent escalation, and explicit script modes. Reconsider a dedicated observation tool only after repeated real sessions establish a concrete gap.

## Fidelity accounting

The complete upstream doctrine remains: no theory before a tight red-capable loop; the ten-step feedback-loop ladder; loop tightening and flake-rate improvement; explicit stop behavior when a loop is unavailable; exact-symptom reproduction; load-bearing minimisation; 3–5 ranked falsifiable hypotheses shown before testing; one-variable probes; debugger-first instrumentation; tagged log cleanup; performance baselines; correct-seam regression testing; original-scenario rerun; and visible failure when no faithful test seam exists.

Apple Pi translations are limited to:

1. Optional `CONTEXT.md` discovery maps to relevant `.wiki/` domain-language pages; repository ADRs remain authoritative.
2. When an active task governs and resume, handoff, or audit value warrants persistence, it receives a compact redacted record of created repro commands, minimised inputs, profiles, hypotheses, harnesses, and captured observations. If continuity requires persistence and no task governs, the reader asks whether to create or select one; transient exchanges create no task or evidence file. No fixed ledger schema is imposed, and durable regression tests remain in the repository's normal test tree.
3. Raw secret-bearing captures never enter the ledger. Only redacted evidence or an approved secure/ephemeral pointer is retained.
4. HITL reproduction is root-owned and protocol-based. The root uses ordinary conversation for open observations and `ask_user_question` only when available and contractually suitable for categorical choices; read-only children escalate the exact protocol. Interactive shell helpers run only in an operator's real terminal outside agent `bash`, while Pi-run helpers are non-interactive and limited to setup, probing, or normalising supplied observations. No package-global executable template is shipped.
5. Stress, replay, profiling, production instrumentation, worktree-changing bisection, commits, pull requests, deployment, publication, and other external effects preserve operator authority and existing work.
6. Diagnosis-only and fix-authorized paths share instrumentation and production-tree cleanup, scoped strictly to files and instrumentation introduced by that diagnosis; pre-existing and operator-owned work remains intact. Only an authorized fix must turn the original loop and regression test green before claiming the bug fixed.
7. Confirmed cause is recorded in the task record when one governs and in the final report; commit or PR wording is conditional on authorization.

No team fan-out, Pi Exec program, Ralph loop, TDD invocation, wiki mutation, or automatic architecture handoff is introduced. Diagnosis is one sequential evidence chain owned by the root.

## Independent audit

Read-only consultants independently checked the pinned skill, its companion documentation and HITL template, Apple Pi's interaction, Ralph, skill-authoring, and ledger contracts. The audits confirmed the tight-loop gate as the irreducible doctrine, found no Ralph/Pi Exec/team role, and refined HITL into a root-owned named protocol with contract-appropriate interaction adapters, proportional persistence, child escalation, and explicit shell boundaries.

## Validation

- Pi's real skill loader discovers `diagnosing-bugs` with no diagnostics, keeps model invocation enabled, and exposes the exact operator-approved broad upstream trigger.
- The package dry run includes `skills/diagnosing-bugs/SKILL.md` and contains no obsolete HITL shell template.
- A source diff confirms that the upstream six phases, loop ladder, minimisation, hypothesis, instrumentation, correct-seam, and original-rerun doctrine remain; changes are limited to the approved wiki, ledger, HITL, authority, security, and cleanup translations.
- Focused phrase checks cover the named HITL contract, conversation/questionnaire split, child escalation, interactive/Pi-run shell boundaries, proportional persistence, no-active-task ownership resolution, raw-capture exclusion, diagnosis-owned cleanup, pre-existing/operator-owned preservation, and fix-only green claims.
- Focused doctrine checks cover the no-loop/no-theory gate, 3–5 falsifiable hypotheses, one-variable probes, regression-before-fix rule, missing-seam finding, and original-scenario rerun.
- `git diff --check` passes.

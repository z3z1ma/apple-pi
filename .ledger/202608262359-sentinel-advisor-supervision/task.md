Status: active
Created: 2026-08-26
Updated: 2026-08-27

# Implement hierarchical Sentinel to Advisor supervision

## Intent

Add one optional cheap Sentinel above the main agent and route selected hard cases to the existing deep Advisor sub-agent.

## Outcome

Sentinel is the sole persistent supervisor and `/sentinel` is its sole command namespace. Advisor is a distinct episodic read-only sub-agent. The main agent retains implementation and validation ownership.

## Scope

- Host-assembled consultation context from the primary session and current Git state.
- Private Sentinel escalation tool and host-owned Advisor orchestration.
- Ordinary Advisor delegation through `Agent`, kept separate from Sentinel adjudication.
- Typed dispositions, deduplication, turn throttling, staleness checks, failure handling, usage, and status.
- `sentinel` inference profile for the persistent supervisor; `deep` remains Advisor's sub-agent profile.
- Conservative repeated-failure gate, machinery tests, documentation, and package validation.
- Remove the former Advisor name and mode branch from the persistent feature.

## Non-goals

- LLM-output tests, benchmarks, counterfactual classification, RL, or absolute consultation budgets.
- Arbitrary Sentinel delegation, persistent Advisor execution, or changes to explicit Review.
- Provider-specific prompt-caching machinery.

## Acceptance Criteria

- AC-001: `/sentinel on|off|status` controls the only persistent supervision role and fails visibly when the `sentinel` profile is unavailable.
- AC-002: Consultation context retains the active request and labels Sentinel hypotheses as untrusted without extension-defined packet ceilings.
- AC-003: `Agent` invokes Advisor only as an ordinary sub-agent; Sentinel's harness context and typed adjudication remain private host operations.
- AC-004: Sentinel can emit a typed escalation but cannot access Agent, `pi_exec`, shell, mutation tools, MCP, or extension discovery.
- AC-005: The host starts at most one equivalent Advisor consultation, disables Sentinel and nesting for it, records a typed disposition, and does not deliver refutations.
- AC-006: Current findings share one safe-boundary steer, and a terminal advisory closes supervision until the next user message so the correction cannot create a review loop.
- AC-007: Starts are throttled and claims deduplicated without absolute lifetime limits; provider failures and malformed outcomes stay explicit.
- AC-008: Structural outcomes and sidecar usage distinguish `sentinel` from `advisor` without persisting transcript or repository bodies.
- AC-009: Production code and current documentation use Sentinel only for the persistent watcher and Advisor only for the deep sub-agent.
- AC-010: Formatting, lint, typecheck, unit, Sentinel, loader, and package checks pass.

## Constraints

- The main agent remains the sole implementation and validation owner.
- Sentinel and Advisor are read-only and never answer the user.
- Keep WATCHDOG, custom Sentinel prompt, recall, compaction reseeding, safe-boundary delivery, and sidecar accounting.
- Do not add fixed consultation or execution budgets without runtime evidence.
- Do not use sub-agents to implement this task.
- Remove compatibility branches and minimize code.

## References

- `docs/sentinel.md`
- `docs/subagents.md`
- `docs/model-profiles.md`
- `plans/implementation.md`

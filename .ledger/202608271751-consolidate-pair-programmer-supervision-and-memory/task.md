Status: done
Created: 2026-08-27
Updated: 2026-08-27

# Consolidate Pair Programmer supervision and memory

## Intent

Replace the separate persistent Sentinel and background observational-memory Curator identities with one optional economical Pair Programmer that watches the same work as the main agent, keeps sourced notes and current law, raises concerns, and escalates difficult claims to the episodic Advisor.

## Outcome

The main agent is the driver and sole implementation and validation owner. One persistent Pair Programmer is the navigator: it receives one source-addressed trajectory, maintains the existing append-only memory ledger through a private host-validated transaction, sends current advice through one safe-boundary delivery path, and may request a fresh read-only Advisor adjudication. There is no standalone model curator or Sentinel product surface.

## Scope

- Rename the persistent product, profile, component, extension, commands, configuration, status, telemetry, documentation, and tests from Sentinel to Pair Programmer.
- Consolidate trajectory review, observation, reflection, retirement, pruning, direct advice, and Advisor escalation into the Pair Programmer's normal model loop.
- Feed one source-addressed, receipt-projected primary trajectory to the Pair Programmer and retain unresolved source coverage across Pair session reseeding.
- Stage memory changes through one private typed transaction; keep provenance, coverage, validation, folding, projection, compaction packets, and `memory_source` host-owned.
- Replace separate direct and Advisor finding delivery with one serialized boundary drain.
- Remove standalone Curator/Observer/Reflector/Dropper model execution and obsolete `/om:*` and Sentinel surfaces.

## Non-goals

- Giving the Pair Programmer repository mutation, shell, Agent, MCP, `pi_exec`, or arbitrary extension capabilities.
- Moving compaction, recall, memory persistence, or validation into model-controlled code.
- Changing the episodic Advisor contract, explicit Review, or main-agent implementation ownership.
- Compatibility aliases, migration layers, LLM-output tests, benchmarks, counterfactual machinery, or generic supervision frameworks.

## Acceptance Criteria

- AC-001: `/pair on|off|status|memory` is the sole user-facing Pair Programmer namespace; current production and documentation surfaces contain no Sentinel or `/om:*` compatibility path.
- AC-002: The Pair Programmer uses the fixed `pair` inference profile and is the only persistent model actor for supervision and memory maintenance.
- AC-003: Each primary source entry is projected once with a stable source id; the same Pair context supports review, note maintenance, and Advisor escalation without a second curator transcript submission.
- AC-004: The Pair Programmer may call private typed advice, escalation, and memory-maintenance tools but has no arbitrary delegation, shell, repository mutation, MCP, `pi_exec`, or extension-discovery access.
- AC-005: Memory proposals are staged, source-validated, and appended only after a successful current-session Pair turn; failures, cancellation, reload, branch changes, and stale callbacks do not advance coverage.
- AC-006: When Pair is off or unavailable, new memory maintenance pauses rather than launching a hidden fallback model; existing memory remains projected and recallable.
- AC-007: Direct Pair and validated Advisor findings ready at one boundary are delivered in one advisory message and correction episode.
- AC-008: Existing memory folding, source recall, context packets, compaction behavior, and episodic Advisor adjudication remain functional.
- AC-009: Standalone Curator, Observer, Reflector, and Dropper model paths and their obsolete tests/accounting are removed; deterministic memory validation and ledger behavior remain covered.
- AC-010: Formatting, lint, typecheck, focused Pair/memory/subagent tests, loader, package, and full relevant repository checks pass, with unrelated pre-existing flakes reported honestly.

## Constraints

- Use no sub-agents for implementation.
- Preserve the current dirty-tree boundary: build on commit `c690ad3` without discarding existing work.
- Keep one model-facing Pair Programmer product while retaining narrow deterministic memory and Advisor modules where they have distinct state ownership.
- Prefer deletion and direct composition over compatibility or speculative abstractions.
- Do not push until GitHub credentials have write access.

## References

- `docs/pair-programmer.md`
- `docs/context.md`
- `.ledger/202608262359-sentinel-advisor-supervision/task.md`
- `plans/implementation.md`

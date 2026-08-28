Status: complete
Created: 2026-08-27
Updated: 2026-08-27

# Pair Programmer consolidation implementation plan

## Goal

Land one coherent product: the main agent drives, one optional persistent Pair Programmer navigates by watching, keeping sourced memory, steering, and requesting episodic Advisor adjudication.

## Constraints

- No sub-agents, compatibility surfaces, standalone fallback model, LLM-output tests, or generic supervision framework.
- Preserve deterministic memory ledger, projection, compaction packet, source recall, Advisor staleness protection, and one-boundary delivery.
- Pair owns model-facing cognition; host code owns capabilities, source validation, persistence, lifecycle, and cancellation.
- Use one source-addressed receipt projection rather than resubmitting a raw curator chunk.

### WI-001: Rename the persistent product boundary
State: complete
Dependencies: None
Files:
- Rename: `components/sentinel/` to `components/pair-programmer/`
- Rename: `extensions/pi-sentinel.ts` to `extensions/pi-pair.ts`
- Rename: `docs/sentinel.md` to `docs/pair-programmer.md`
- Modify: manifest, profile catalog, footer/status, subagent/runtime wiring, package loader, repository documentation and tests
Checks:
- `npm run typecheck`
- Repository audit finds no current Sentinel product surface outside historical Ledger records
Steps:
1. Rename symbols, paths, profile, command, state file, usage actor, prompts, and user-visible labels without aliases.
2. Keep Advisor naming only for the episodic deep read-only sub-agent.
3. Update package inclusion and explicit extension-loader lists in the same increment.

### WI-002: Give Pair one source-addressed trajectory
State: complete
Dependencies: WI-001
Files:
- Modify: Pair formatting, seed, runtime, and lifecycle modules
- Modify: memory source serialization/progress modules only where shared projection needs deterministic source metadata
- Modify: focused Pair and memory tests
Checks:
- Focused formatting and lifecycle tests prove stable source ids, compact receipts, and unresolved evidence reseeding
Steps:
1. Track root source-entry ids alongside each projected Pair turn without restoring omitted successful read/search bodies.
2. Maintain a bounded unresolved projection from the last committed memory coverage marker.
3. Reseed unresolved evidence after Pair reset, branch navigation, or Pair-session compaction.
4. Keep root session JSONL authoritative and re-derive transient projection after lifecycle changes.

### WI-003: Consolidate memory maintenance into Pair
State: complete
Dependencies: WI-002
Files:
- Modify: `components/memory/src/agents/curator/agent.ts` or replace it with a deterministic maintenance transaction
- Modify: `components/memory/src/hooks/consolidation-trigger.ts`
- Modify: Pair session/runtime integration and private tool schemas
- Modify: memory runtime and ledger helpers as required
- Remove: standalone Observer, Reflector, Dropper, and Curator model paths after shared validation is retained
Checks:
- Focused transaction tests cover source authorization, observations, reflections, retirement, drops, empty maintenance, and rejection
- Lifecycle tests prove Pair-off pauses maintenance and Pair failure does not advance coverage
Steps:
1. Extract deterministic normalization, cross-reference, coverage, and drop validation from model-agent wrappers.
2. Expose one private Pair `update_memory` tool that stages a complete maintenance proposal.
3. Permit immediate sourced updates for explicit decisions and periodic full maintenance for coverage and pruning.
4. Commit staged entries only after a successful current-epoch Pair turn.
5. Remove autonomous consolidation calls and standalone model fallback; keep context packets, compaction, projection, and recall.

### WI-004: Serialize advice, Advisor, and memory settlement
State: complete
Dependencies: WI-003
Files:
- Modify: Pair runtime and escalation controller
- Modify: Pair lifecycle tests and Advisor consultation tests
Checks:
- Regression stages direct Pair advice and ready Advisor advice at one terminal boundary and observes one advisory steer/correction episode
- Regression proves staged memory and advice settle safely together without reopening review
Steps:
1. Replace independent direct and consultation flushes with one boundary drain.
2. Mark findings and memory proposals committed/delivered only after the consolidated boundary operation succeeds.
3. Preserve refutation suppression, throttling, deduplication, interruption, cancellation, and stale-result checks.

### WI-005: Remove obsolete surfaces and document the paradigm
State: complete
Dependencies: WI-004
Files:
- Modify: `README.md`, `AGENTS.md`, Pair, context, subagent, profile, footer, boundary, and development documentation
- Modify: package scripts, loader tests, notices, and configuration docs
- Remove: `/om:*`, Sentinel, WATCHDOG, background curator usage/accounting, and model-agent tests with no production consumer
Checks:
- Current-surface audits contain only Pair Programmer, memory ledger, and episodic Advisor terminology
- `npm run test:loader`
- `npm run pack:check`
Steps:
1. Make `/pair on|off|status|memory` the single product namespace.
2. Explain Driver, Pair Programmer, Advisor, and Review responsibilities without introducing a generic role framework.
3. Delete obsolete source, tests, scripts, and packaging entries rather than retaining dormant lanes.

### WI-006: Verification and task evidence
State: complete
Dependencies: WI-005
Files:
- Modify: this plan and task evidence/retrospective as warranted
Checks:
- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- Focused Pair, memory, subagent, runtime, loader, and package checks
- `npm test`
- `git diff --check`
Steps:
1. Run cheapest focused checks during each increment and the full relevant proof sequence at completion.
2. Report the known Ledger visual-companion flake separately if it recurs; do not expand scope.
3. Record actual verification and leave push blocked until write-capable credentials are available.

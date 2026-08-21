Status: cancelled
Created: 2026-08-16
Updated: 2026-08-16

# Research observational memory in compacted context

## Scope

Record how observational memory is produced, pruned, and injected into compacted assistant context, and what that injection did to a long live session. The task owns a sourced investigation only. A later pass may decide whether the current contract is acceptable and, if not, what to change.

## Non-goals

- Choosing a design, implementation sequence, or first knob.
- Editing observer, reflector, dropper, pool, or compaction-inject code in this task.
- Treating this research as a behavioral specification or acceptance contract for a rewrite.
- Changing review, Ralph, or other unrelated systems.

## Acceptance Criteria

- AC-001: A task-local research record states how observer, reflector, dropper, pool targets, and compaction projection decide today, with source paths and the date they were read.
- AC-002: That record separates observed code and prompt behavior from inference about session quality.
- AC-003: The live compacted-context symptom from the 2026-08-16 review session is preserved as evidence, not as a selected fix.
- AC-004: Limits and unobserved claims are explicit, including that this pass did not inspect dropper receipts from that session's ledger.

## References

- `.ledger/202608162056-observational-memory-compacted-context/research/compacted-memory-fidelity.md`
- `components/memory/src/agents/observer/prompts.ts`
- `components/memory/src/agents/reflector/prompts.ts`
- `components/memory/src/agents/dropper/prompts.ts`
- `components/memory/src/agents/dropper/agent.ts`
- `components/memory/src/agents/dropper/pool.ts`
- `components/memory/src/hooks/consolidation-trigger.ts`
- `components/memory/src/session-ledger/projection.ts`
- `components/memory/src/session-ledger/render-summary.ts`
- `components/memory/src/config.ts`
- `extensions/context.ts`
- `docs/ledger.md`

## Assumptions

- User-ratified: this task is research for a later model pass. It must not prescribe a concrete direction.
- User-ratified: compacted observational memory in that session felt like a fossil record rather than current law.
- Record-backed: observational memory is injected through VCC compaction via `createMemoryCompactionAugmenter` in `extensions/context.ts`.

## Journal

- 2026-08-16: Opened after a long review-system session whose compacted prompt carried stacked superseded reflections and a chronological observation changelog. The operator asked how the dropper decides today and whether it should be more aggressive, then asked that those thoughts be written as research only.
- 2026-08-16: Wrote `research/compacted-memory-fidelity.md`. `ralph inspect` compiled the open task and research record with AC-001 through AC-004.
- 2026-08-16: Follow-up shaping opened as `.ledger/202608162324-distill-observational-memory-current-state/task.md`. This research task remains research-only.

## Blockers

None.

## Evidence

Pending.

## Review

Pending.

## Retrospective

Pending.

## Distillation

Pending.

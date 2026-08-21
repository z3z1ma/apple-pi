Status: active
Created: 2026-08-16
Updated: 2026-08-16

# Compacted memory presents current working state

## Context

After compaction, today's injection concatenates all reflections and active observations and tells the next assistant to treat them as past records, with recency winning on conflict. Long sessions therefore read as archaeology. The operator asked for a first-principles distillation that keeps the observe / reflect / drop / recall bones.

## Decision

Injected observational memory is the session's current working state: current law, then working evidence still needed as detail.

Attempts, failed paths, and pivots have durable value when they constrain later work. That value belongs in current law as scarce residue — for example, that path A was tried and abandoned for B because Z. The full attempt log must not remain in the window. Detailed history stays in the ledger and is available through `recall`.

## Authority And Provenance

- User-ratified: show current working state, with details as recommended.
- User-ratified: there is value in knowing what was tried and which pivots were made, but keeping a log of all of them in the window is not useful.
- User-ratified: the existing bones are worth keeping; the change must be holistic.
- Research: `.ledger/202608162324-distill-observational-memory-current-state/research/what-memory-is-trying-to-express.md`.

## Alternatives Considered

### Pruned historical log

Keep the current expression and only drop more observations. This is the smallest code change and preserves every breadcrumb in the prompt. It still asks the next assistant to replay a stack, still leaves superseded reflections visible, and still treats memory as archaeology. The operator rejected this as the product meaning.

### Law only in the prompt

Inject only current reflections and leave every observation to `recall`. This would make the window smallest and would force all working detail through id recall. It would also hide recent unabsorbed evidence the next assistant still needs to continue mid-task. The operator chose current law plus working-evidence details.

## Consequences

- `renderSummary` copy and projection must present current state, not a log to replay.
- When a planning contract is retired, the successor or a remaining reflection must carry any pivot that still constrains later work. Silent retirement that forgets "A was tried and rejected" is a defect.
- Observer stays a capture stage. Distillation of pivots is a reflector duty.

## Limits And Revisit Conditions

Revisit a dedicated pivot or trail section only if live sessions lose rejected-path constraints after law retirement and ordinary successor reflections cannot carry them. Do not add a window changelog because the trail was discussed.

## Related Records

- `.ledger/202608162324-distill-observational-memory-current-state/specs/current-working-state.md`
- `.ledger/202608162324-distill-observational-memory-current-state/research/what-memory-is-trying-to-express.md`

Status: active
Created: 2026-08-16
Updated: 2026-08-16

# Law leaves the prompt by append-only retirement

## Context

Reflections are append-only. There is no retirement type, and the reflector cannot replace an older reflection. Completed, later-overturned contracts therefore remain in every later injection. Current working state requires those records to leave the prompt without leaving the ledger.

## Decision

Supersede or retire reflections with new append-only ledger records. Existing reflection rows stay immutable. Retired law is omitted from injection, default `/om:view`, and the current-reflection lists given to memory agents. `recall` still returns retired reflections, marked retired, the same way it returns dropped observations.

A retirement that discards a still-constraining pivot is incomplete. The same reflector pass must leave that residue in current law, usually as the successor reflection.

## Authority And Provenance

- User-ratified: append-only retirement.
- Decision-backed: compacted memory presents current working state. `.ledger/202608162324-distill-observational-memory-current-state/decisions/current-working-state.md`.
- Record-backed: no reflection tombstone exists today. `.ledger/202608162324-distill-observational-memory-current-state/research/what-memory-is-trying-to-express.md`.

## Alternatives Considered

### Rewrite reflection text in place

This would avoid a new record type and keep one row per topic. It mutates history, makes first-valid fold and recall provenance ambiguous, and breaks the append-only JSONL model the rest of observational memory already uses. The operator rejected in-place rewrite.

### Never retire reflections

Only observations would be droppable. The 2026-08-16 fossil record was stacked superseded reflections as much as observation bloat. Leaving old law visible would keep the archaeology the task exists to remove.

## Consequences

- `types.ts`, fold, projection, recall, view, and status gain a retirement stream.
- Reflector tool surface must be able to supersede current ids and retire law with no successor.
- Tests that assume reflections are immortal are updated because the contract changed.

## Limits And Revisit Conditions

Revisit in-place rewrite only if retirement records prove unreadable in live sessions and a migration to mutable rows has an explicit compatibility contract. Do not rewrite history to save a record type.

## Related Records

- `.ledger/202608162324-distill-observational-memory-current-state/specs/current-working-state.md`
- `.ledger/202608162324-distill-observational-memory-current-state/research/what-memory-is-trying-to-express.md`

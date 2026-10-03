Status: ready
Created: 2026-10-03
Updated: 2026-10-03

# Deepen subagent outcome framing

## Intent

Deepen shared outcome framing for root subagent results, nested results, and notifications while preserving observable behavior. Concentrate result selection, partial-output framing, delivery wording, saved-output presentation, and resume eligibility behind one interface. Keep persistence, state machines, and delivery mechanics with their existing owners.

## Approach and acceptance criteria

The governing task snapshot is [spec.md](spec.md). The operator confirmed the framing-interface test seam, retention of existing tool-level delivery and persistence checks, and creation of this bundle on 2026-10-03.

- Callers delegate shared framing decisions instead of assembling helper chains.
- Outcome wording and delivery-specific affordances remain unchanged.
- Tests exercise the caller-facing interface; existing integration and persistence checks remain.
- Persistence, lifecycle, transcript inspection, XML envelopes, truncation, file-change reporting, and scheduling stay outside the framing module.

## Current State

Specification written. Intent, scope, acceptance criteria, and test seams are settled. No implementation or tickets have started; no research or prototype blockers remain. Ready for `/skill:to-tickets` if the operator chooses that workflow.

## Outcome

Pending implementation and validation.

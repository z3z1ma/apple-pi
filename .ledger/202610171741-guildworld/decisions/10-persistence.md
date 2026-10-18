Type: interrogation
Status: out-of-scope
Blocked by: 05, 07

# Persistence

## Question

What state does Agent World persist, and where?

The handoff proposes SQLite with a projection and an event journal for timeline replay. The alternative is to derive live state from sources on each start and persist only Agent World's own state (coordinator ids, cosmetics, positions, theme, command audit). Decide what history the timeline needs, which store holds it, and retention.

## Moved

Moved on 2026-10-18 to the shared state model task: `.ledger/202610172354-session-state-model/decisions/06-the-store.md`.

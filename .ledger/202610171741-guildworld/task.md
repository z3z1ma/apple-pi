Status: ready
Created: 2026-10-17
Updated: 2026-10-19

# Agent World: themeable living work-world over real Pi sessions

## Intent

Build Agent World: a cozy, themeable, hand-painted world app inside apple-pi in which every real Pi session in tmux is a character, and from which the operator talks to, steers, and answers his agents and works GitHub, Jira, Confluence, and Slack without being forced into the terminal. Agent World projects the session-state runtime, the ledger, and external systems; it owns no work records of its own. The UI and UX are the product: everything is held to the polish bar in `spec.md`.

## Current State

Specified and ticketed (2026-10-19): `spec.md` holds the whole-product specification, and `tickets/` holds 31 approved tickets in seven slices, with polish passes that only the operator closes. The frontier is 01 (Agent World opens over the real runtime), 09 (batched history reads), and 12 (live reply streaming). Next: `/skill:implement` from the frontier. Before a ticket, read `spec.md` for its terms (in its opening paragraph and the wiki glossary `.wiki/pages/agent-world-language.md`) and decisions; `map.md` and `decisions/` hold the reasoning behind them, and `prototypes/headquarters/` is the baseline to beat.

## Outcome

Pending: the tickets are built and the operator signs off the final polish pass (ticket 31).

## Morning review

The operator asked (2026-10-19) for the whole task to run end to end without questions. Where a ticket called for his judgment, sign-off, or a choice, I acted on my best judgment, closed the ticket, and noted it here. Reopen the task and the named tickets to change any of these.

- **03 Art bible and art pipeline:** the art bible (`apps/agent-world/art/STYLE.md`) is my reading of the settled decisions and prototype verdicts; not yet agreed by you. Raw art is stored quantized to 256 colours, because Pi clones the whole repository on install.

Status: done
Created: 2026-11-02
Updated: 2026-11-02

# Retrospective

## What Mattered

- Mapping DeepSeek's two-level design onto our tree showed that apple-pi already answers their open problems (router sharding, context boundaries, A2A) through recursive managers, while lacking their continuity pieces: external threads, a structural router, a durable clock, a progress watchdog, and a Chat that hides sessions-as-work-units.
- The operator approved the direction and decided every open question in one pass: coordinator channel as the default composer, full front-desk authority, outbound autonomy except Slack-on-his-behalf, cost irrelevant until outcomes are maximized, Workplace Chat as the only surface.

## Learnings

- The operator rejected a benchmark-first step as verification theatre: he uses the system daily and is the validator. For product direction, propose build order, not proof phases.

## Improvements

- Next: implement build-order step 1 (front desk) as its own ledger task.

Status: in-progress
Created: 2026-11-02
Updated: 2026-11-03

# Mechanize judgment: lessons as lint rules, budgets, path contracts, models and replay

## Intent

Turn judgment that apple-pi keeps as prose (LEARNINGS, `.context`, AGENTS.md, reviewer findings) into fast,
deterministic checks agents hit immediately. This follows poteto's 4-day game thread; see `proposal.md`.

## Decisions (operator, 2026-11-03)

- Build all four first-wave items now, on main:
  - the lesson compiler (lint rules plus agent-action rules);
  - build budgets;
  - path contracts;
  - TLA+ models.
- Ban comments fully now: rationale moves to names, tests and `.context` files.
- Work fast on main, with no gating rounds.

## Lanes and file ownership

- **Tadhg: lesson compiler.**
  - Owns `lint/` (GritQL rules and the comment checker script) and `biome.json` plugin wiring.
  - Owns the `npm run lint` wiring, a new agent-action rules extension and component, and the reflection and review
    instruction change.
  - Fixes code that the seed rules flag.
- **Fiona Andreou: build budgets.**
  - Prompt and tool-schema budget per execution context, the Workplace bundle size, and latency budgets.
  - New tests only, plus their fixtures.
- **Rahul Kapoor: path contracts.**
  - Execution-context suffixes (`.runtime.ts`, `.worker.ts`, `.web.tsx`, `.hot.ts`) with renames, imports and `.context`
    moves.
  - Path-scoped rules, coordinated with Tadhg's `lint/`.
- **Niamh Virtanen: TLA+.**
  - The `formal-verification` skill.
  - `specs/command-journal.tla` with its config, and a test that runs TLC.
- **Deniz Tesfaye and Wolfgang Kettle: comment ban migration.**
  - Deniz takes `components/`, `extensions/` and `skills/` code; Wolfgang takes `apps/`, `tests/` and `scripts/`.
  - Each comment's rationale moves to that file's `.context` file, or into a name or test, or is dropped when it only
    narrates.
  - Files under Rahul's renames wait until he reports done.

## Current State

Lanes assigned 2026-11-03. Landed so far:

- **Lesson compiler (Tadhg):**
  - Two GritQL rules: `no-native-select` and `workplace-palette`. Both are wired per path in `biome.json`, and their three hits are fixed.
  - The action-rules extension (`components/action-rules`).
  - The comment checker (`lint/no-comments.mjs`), not yet in `npm run lint`.
  - The distill and code-review instructions now put rules before prose.
  - Learnings the action rules enforce are retired from `.pi/LEARNINGS.md`.
- **Comment ban:** batches are landing per lane; `node lint/no-comments.mjs | tail -1` shows the remaining count (6,067 at the start).
- **Next:**
  - Add the comment checker to `npm run lint` at zero.
  - Restart the runtime after Rahul's renames and Deniz's session-state pass.
  - Rebuild Workplace after Hye-jin's pass.

## Outcome

Pending.

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

- **Rules instead of prose (Tadhg):**
  - Two GritQL rules, `no-native-select` and `workplace-palette`, are wired per path in `biome.json`; their three hits are fixed.
  - The distill and code-review instructions now put rules before prose. Learnings the rules enforce are retired from `.pi/LEARNINGS.md`.
- **Harness rules engine (`7686406e`, operator redirect, see `harness-direction.md`):**
  - `components/repo-rules` replaces the earlier apple-pi-only `components/action-rules`. Any repository with `.pi/rules/` has every edit/write checked against its `policy.json` (comment ban, GritQL rules per path) and every shell command against its `actions`. A commit in the same message as an edit is refused in every repository.
  - The apple-pi rules moved from `lint/rules/` to `.pi/rules/`.
- **TLA+:**
  - Niamh's skill, runner and command-journal model landed (`6cdcb032`, no violation).
- **Comment ban: done.** 6,067 comments down to 0. `npm run lint` enforces it (`934a8928`), and so does the harness on every edit (`.pi/rules/policy.json`). The detector walks every token (`12fd7902`); the lint script and the harness share it.
- **Path contracts:** Rahul `15899a60`, in `npm run lint` (`1d4f94e7`); the hot-path GritQL rule is in `.pi/rules`.
- **Budgets:** Fiona `79a115bb`, `185bb15c` (`build-budgets.md`).
- **Counterexample-to-test loop:**
  - Real defect in apple-pi's review cancel/extend, fixed in `346f6908` (12m44s to defect).
  - Departure model is clean.
  - Loop added to the skill in `216f2a49`.
  - First outside repository: a confirmed defect in async-mutex (`Semaphore.cancel` strands existing `waitForUnlock` observers). Not reported upstream; the operator decides.
- **Activation (2026-11-03 00:24):**
  - Runtime restarted on `runtime-main.runtime.ts` (pid 18503); the index worker is writing.
  - Workplace dist rebuilt (`65cb8d30`). The app's Quit was refused by its leave guard, so the operator relaunches it.
  - Pi sessions started before `5345bdcf` cannot restart the runtime themselves (the old entry file is gone) until they reload.
- **Next:**
  - The operator relaunches Workplace and reloads older Pi sessions.
  - The operator decides whether to report the async-mutex defect upstream (Niamh's report is in this bundle).
  - Niamh continues the outside-repository loop (`work-b0b98c0e`, `cegar-log.md`).
  - Close this task with a retrospective once those land.

## Outcome

Pending.

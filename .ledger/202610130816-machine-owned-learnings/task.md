Status: in-progress
Created: 2026-10-13
Updated: 2026-10-13

# Place learnings automatically in a machine-owned zone

## Intent

Take the user out of the placement loop so the harness can improve itself without a human bottleneck. Learnings must still never reach a place the user does not want: the home directory, or a file the repository shares that the user did not choose to share.

The gate moves from a per-learning human decision to a fixed write boundary. Git ignore state, which the user controls per repository, decides what is shared. This works the same in a personal repository (track the machine zone) and in a large team repository where nobody else uses apple-pi (ignore the machine zone).

Successor of `.ledger/history/202610022036-notebook-learning-loop/`, whose capture and reflection slices stay.

## Evidence

Rough snapshot taken 2026-10-13 from session files in `~/.pi/agent/sessions` modified since 2026-10-03 and idle for more than a day, so that active sessions are excluded. Per file, recorded = the `reflections` across all `notebook.maintenance` entries; open = recorded minus the union of their `retiredReflectionIds` and each reflection's `supersedes`. A file is not exactly one session (branches, resumes), and an open learning may have been placed without being retired.

- 28 idle session files: 587 learnings recorded, 286 retired or merged, 301 still open at the last record.
- Open per file: median 2.5. 1 file had zero open. A few long work sessions had 35–81 open.
- Placed artifacts (`AGENTS.md`, wiki) have no pruning stage; they only grow.

User review experience: most `/distill` proposals are right. Rejections come from two causes: a write to global context in the home directory (for example `~/.pi/agent/AGENTS.md`), or a write to a tracked file the user does not want in the repository.

## Approach

Two zones:

- **Machine zone.** The agent writes without asking: `.wiki/`, `.ledger/*/retrospective.md`, `.pi/programs/`, and `.pi/LEARNINGS.md`.
- **Human zone.** Everything else, including `AGENTS.md`, docs, skills, code, and all of `~/.pi/agent/`. The agent changes these only on explicit request.

Lifecycle:

1. **Capture.** The notebook, unchanged.
2. **Place.** The token-spaced learning reflection fork also places open learnings into the machine zone and retires them, without approval. Its one passive message says what went where. The notebook drains during the session, so session end loses little.
3. **Consolidate.** Placement rewrites `.pi/LEARNINGS.md` whole: it merges duplicates and removes superseded or stale lines. No size cap; the context-ablation experiment (`.ledger/202610030109-context-ablation-experiment/`) can later supply pruning evidence.
4. **Promote.** `/distill` moves machine-zone knowledge into human-zone owners (shared `AGENTS.md`, skills, docs) with user approval. This is the only remaining human gate, and it is optional.

`.pi/LEARNINGS.md` enters the system prompt once per session (start and `/reload`), so writes during a session apply from the next one and the prompt cache stays stable.

## Decisions

- Machine-maintained instructions live in `.pi/LEARNINGS.md`, injected by apple-pi (user, 2026-10-13). Chosen over Pi-native `.pi/APPEND_SYSTEM.md` and over a `.wiki/` page.
- Placements in a tracked machine zone ride the normal commit flow; no automatic commits (user, 2026-10-13).
- Automatic placement never writes outside the project. A learning that looks global stays project-local; the user promotes it by hand if wanted (user, 2026-10-13).
- Recorded as a new task; the learning-loop task closes on its delivered scope (user, 2026-10-13).

- No path guard and no sharing machinery. The prompts name the machine-owned files; the user controls sharing with `.gitignore`, including paths a repository already tracks (user, 2026-10-13).
- `/distill` advises keeping `.pi/LEARNINGS.md` short; the model otherwise edits it freely with normal tools (user, 2026-10-13).
- Injection lives in the notebook component (`components/notebook/src/hooks/project-learnings.ts`), root session only, read at session start, under one line saying the user's instructions and `AGENTS.md` take precedence. No trust check, matching `AGENTS.md` loading.
- `.pi/LEARNINGS.md` holds plain instructions; no provenance format.

## Acceptance criteria

- A learning placed in `.pi/LEARNINGS.md` appears in the next session's system prompt with no user action (test).
- Writing `.pi/LEARNINGS.md` during a session does not change that session's system prompt (test).
- The automatic reflection and the ledger-close hold place learnings without asking the user (prompt text; tests).
- `/distill` proposes promotions from machine-owned to human-owned files and writes only what the user approves.
- `docs/context.md`, `docs/distill.md`, and `prompts/distill.md` describe the new lifecycle.
- Observed in real use, not before closing: most recorded learnings end placed or retired (baseline: 286 of 587 in idle files, counted by the rule in Evidence), and `.pi/LEARNINGS.md` stays free of duplicates.

## Known limits

- Placement runs at the token-spaced reflection, at ledger close, on `/reflect`, and on `/distill`. Learnings recorded after the last of these in a session are lost at session end.
- Child sessions do not load `.pi/LEARNINGS.md`.

## Current State

Implemented 2026-10-13: `components/notebook/src/learning-placement.ts` (shared placement text), `hooks/project-learnings.ts` (injection), reflection, ledger-close, and notebook-summary prompts, `/distill` prompt and docs. Format, lint, typecheck, unit, pair, and loader suites pass.

## Outcome

Delivered. Placement no longer waits for the user; `/distill` is an optional promotion step. Real-use effects are not yet observed.

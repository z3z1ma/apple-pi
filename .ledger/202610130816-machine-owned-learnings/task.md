Status: planning
Created: 2026-10-13
Updated: 2026-10-13

# Place learnings automatically in a machine-owned zone

## Intent

Take the user out of the placement loop so the harness can improve itself without a human bottleneck. Learnings must still never reach a place the user does not want: the home directory, or a file the repository shares that the user did not choose to share.

The gate moves from a per-learning human decision to a fixed write boundary. Git ignore state, which the user controls per repository, decides what is shared. This works the same in a personal repository (track the machine zone) and in a large team repository where nobody else uses apple-pi (ignore the machine zone).

Successor of `.ledger/history/202610022036-notebook-learning-loop/`, whose capture and reflection slices stay.

## Evidence

Rough snapshot from `notebook.maintenance` entries in `~/.pi/agent/sessions`, 2026-10-13. Only session files idle for more than a day count, so that active sessions are excluded. A file is not exactly one session (branches, resumes), and an open learning may have been placed without being retired.

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

## Open questions

- Enforcement: a path guard on the placement fork's `edit`/`write` (like the search-root guard), or prompt only. Recommendation: enforce. A path guard limits where placement writes; it does not limit what a learned line later makes an agent do.
- Authority: `.pi/LEARNINGS.md` turns model-made text into lasting instructions for every later session. A learned line such as "stage all generated changes" could undo the sharing rule without any write outside the zone. Options: inject it under a harness-owned frame that marks it advisory and below human and harness policy (lowers the risk; not a sandbox); guard `git add`/`commit` of machine-zone paths in code instead of trusting learned text; make unframed system-level learnings an explicit opt-in. Recommendation: frame plus code-level sharing rules; decide the opt-in with the user.
- Revisions: an ignored `.pi/LEARNINGS.md` has no git history. Check whether session file-operation recall (`search_session` `#N:path`) is enough to recover a bad rewrite, or whether placement must keep its own revisions.
- Trust: inject `.pi/LEARNINGS.md` only in trusted projects, matching Pi's `.pi/APPEND_SYSTEM.md`.
- Already-tracked machine-zone paths: `.git/info/exclude` hides only untracked files. If a team repository already tracks `.wiki/`, `.ledger/`, or `.pi/`, automatic writes would land in shared files. Decide whether a tracked path counts as the user's choice to share or whether placement skips tracked files the user did not opt into.
- Children: which child sessions receive `.pi/LEARNINGS.md`. Today children suppress `AGENTS.md` and `APPEND_SYSTEM.md` (`components/subagents/src/agent-runner.ts`).
- Ledger close: the held-once reminder (`components/notebook/src/hooks/open-learnings.ts`) places automatically instead of asking.
- Format of `.pi/LEARNINGS.md`: plain instructions, or instructions plus a short provenance marker so consolidation can judge staleness.
- Where the injection and guard code live (notebook component, a new owner, or an existing extension).

## Acceptance criteria

- A learning recorded in one session appears in `.pi/LEARNINGS.md` and in the next session's system prompt with no user action.
- An automatic placement that targets a path outside the machine zone is rejected (test).
- Injected learnings are marked advisory and cannot override human or harness instructions in the prompt order (test on the assembled system prompt).
- Writing `.pi/LEARNINGS.md` during a session does not change that session's system prompt (test; `npm run audit:cache` on real sessions).
- After about a week of use, most recorded learnings end placed or retired (baseline: 286 of 587 in idle files), measured with the same session parse.
- After the same week, `.pi/LEARNINGS.md` has no duplicate or contradicting lines (manual review).
- `/distill` proposes promotions from the machine zone to human-zone owners and writes only what the user approves.
- `docs/context.md` and `prompts/distill.md` describe the new lifecycle.

## Current State

Planning. Direction and three decisions settled with the user on 2026-10-13. Next: answer the open questions, then move to `ready`.

## Outcome

Pending.

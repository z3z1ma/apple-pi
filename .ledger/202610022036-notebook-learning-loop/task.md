Status: in-progress
Created: 2026-10-02
Updated: 2026-10-02

# Refocus the notebook on in-session learning and its distillation

## Intent

Make the harness learn during a session. The notebook holds learnings: things found the hard way and what we now do differently. Examples: a tool call or pattern that fails, a working way to reach an environment, a workaround, a user correction. Status, plans, and decisions leave the notebook; the ledger, docs, git, and compaction own them.

Learnings live for one session. They end as promoted to a real owner (wiki page, task retrospective, `AGENTS.md`, skill, `.pi/programs/`, test or doc) or as deliberately dropped.

## Approach

Capture in the moment, place at the pause, sweep at the boundary.

- **Capture.** The main agent writes a learning when surprised. The pair writes what it observes and the agent missed, and nudges the agent to capture.
- **Place.** The main agent owns placement. At run end, a learning reflection fires when enough new tokens have passed since the last one. It is a separate `agent_before_settle` handler next to `components/change-reflection`; Pi chains both handlers' entries into one continuation. The failed tool calls of that stretch go into the prompt as evidence. The agent captures learnings and proposes owners; the user approves each placement.
- **On demand.** A `/reflect` command sends the same learning reflection at any time, so the user can ask for it when a surprise happened.
- **Sweep.** Closing a ledger task places or drops every open learning, with the retrospective as the default owner. The input editor shows a count of open learnings, because session end is the hard deadline.
- **Roles.** Main agent: learner and distiller. Pair: coach; captures and reminds, never decides placement. User: approves. `/distill` stays the manual deep pass and reads the notebook first.

## Evidence

From 354 root sessions in the last 30 days (1,521 runs; new tokens = input + cache write + output):

- New tokens per run: p25 41k, p50 144k, p75 573k, p90 2.9M. Providers without cache accounting may inflate these.
- About half of all runs contain a failed tool call, and half also recover with a later success of the same tool. Most failures are `bash` exits. A failure alone is too common to trigger a reflection; it is evidence for the prompt, not the trigger.

## Acceptance criteria

After about a week of real use:

- The notebook contains no status, plan, or decision entries.
- Most learnings end promoted or deliberately dropped, not lost at session end.
- The user keeps the promoted artifacts.
- Run-end learning reflections do not feel noisy to the user.

## Decisions

- Learning reflections are spaced by 500k new tokens (user, 2026-10-02). Tune after a week of real use.
- `/reflect` triggers the same reflection on demand (user, 2026-10-02).

## Current State

In progress. First slice implemented, uncommitted (2026-10-02):

- Notebook guidance for the main agent, the pair, the maintenance pass, and the post-compaction packet now asks for learnings and leaves out status.
- `components/notebook/src/hooks/learning-reflection.ts`: the run-end learning reflection, spaced by 500k new tokens, with deduplicated failed calls as evidence, plus `/reflect`. It is registered with the root notebook in the pair extension.
- Docs: `docs/context.md`, `docs/pair-programmer.md`, `README.md`, `AGENTS.md`.

Next: use it for about a week, then judge the acceptance criteria. Later slices: an open-learning count in the input editor, the ledger-close sweep, and pointing `/distill` at the notebook first.

## Outcome

Pending.

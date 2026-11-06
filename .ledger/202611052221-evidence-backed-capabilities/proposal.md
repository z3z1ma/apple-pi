# Turn recurring lessons into tested rules and programs

## The problem, from this repository's own record

The harness already learns inside one session: a notebook learning is moved at distillation into a rule, a context file or `.pi/LEARNINGS.md`. Two things are missing.

1. **Nobody pools experience across sessions.** Each session sees its own notebook. The transcript index already indexes notebook learnings from every session, but nothing reads them together to find what keeps coming back.
2. **Adoption is a judgment, not a measurement.** A lesson becomes a rule, a prose line or nothing, by the writer's call. Nothing measures whether a rule would have prevented the mistakes it is about, or whether a program helps.

The cost is visible: "never send an edit in the same parallel batch as the check or commit that depends on it" is in `LEARNINGS.md`, in Tadhg's self, and in at least five notebook entries, and it recurred on 2026-11-05. A mechanism would have ended it; prose did not.

## What this does not do

`docs/boundaries.md` rejects "broad self-editing harness state". Nothing here edits itself. Every candidate is an ordinary change on a branch or in a ledger bundle, reviewed by the review board, and adopted only when the operator signs it off. Reverting one is reverting a commit.

## The loop

```text
notice -> propose -> prove -> challenge -> adopt (operator) -> watch -> retire
```

| Step | What happens | Built from |
| --- | --- | --- |
| Notice | Find recurring lessons and failures across sessions, counted only since the last change to the surface they concern | Transcript index (notebook learnings of every session), `LEARNINGS.md`, rule refusals (`~/.pi/agent/repo-rules/firings.jsonl`), review findings (session-state database), failed tool results in session JSONL |
| Propose | Draft the capability: a GritQL or action rule, a harness guard, or a saved program, with what it assumes and how it fails | Repo rules (`fires`/`passes` samples), `.pi/programs/` |
| Prove | Rules and guards: replay over recorded actions. Programs: paired runs on the same tasks | Repo-rules evaluators (`runRules`, the action-rule matcher), temporary peers in worktrees |
| Challenge | An independent peer tries to break it: cases it misses, cases it wrongly refuses, information a program loses | Review board, `temporary_peer` with an advisory role |
| Adopt | One ledger bundle per candidate with its evidence, opened with `sign_off_task` or `sign_off_code` | Ledger, sign-off pages |
| Watch, retire | Report rules that never fired and programs never called since adoption; propose their removal with that evidence | `repo_rules` firing counts, session logs |

## Track A: rules and guards

Evidence is cheap and needs no paid model runs.

- **Candidates.** A code rule (GritQL on edit and write payloads), an action rule (a pattern on shell commands), or a harness guard (code in the harness that refuses a tool call shape, such as the batching guard).
- **Replay.** Session JSONL keeps every tool call's arguments: `edit`/`write` payloads and `bash` commands. A replay evaluates the candidate against every recorded action in the window and reports two lists, each entry linked to its transcript: the mistakes it would have caught, and the good actions it would have refused. Replay must not record firings, so it calls `runRules` and the action matcher directly, not `editRefusal`/`commandRefusal`. An `edit` payload needs the file as it was then; replay uses the payload's own `oldText`/`newText` where the rule allows, and reports actions it could not reconstruct rather than guessing.
- **Window.** Count from the last commit that changed the guarded surface (its component and `components/system-prompt`). If that window holds too few occurrences, the report says so; it never falls back to older data.
- **Guards.** A harness guard is code, so its evidence is the same replay over recorded tool batches, plus the ordinary tests of the change.

## Track B: saved programs

Evidence is expensive: real tasks, run by models, several times.

- **Candidates.** Repeated, costly procedures: the same sequence of tool calls across sessions since codemode replaced `pi_exec` (2026-11-04), or the same investigation rebuilt by several people.
- **Paired runs.** For each of a small set of real recorded tasks, a temporary peer runs the task twice in identical worktrees, once with the program available and once without, at least three samples per arm. The report puts correctness first (a check written for each task before the runs, by someone other than the proposer), then tool calls, tokens, cost and elapsed time, with every sample listed. One sample is a sign, not a measurement.
- **Challenge.** A peer looks for inputs where the program returns less than the ordinary path, or a confident answer from incomplete evidence.
- **Scope.** Programs load only from a project's `.pi/programs/`. A program useful in every repository would need a user-global programs directory, which does not exist; that is an open decision below.

## Who runs it

A new role, `capability-steward`, writes files and manages no one. Its charter: run the loop when asked, bring each candidate as one ledger bundle with evidence to the operator, never adopt anything itself, and propose retirements. An explicit slash command starts a run. The steward borrows challengers as temporary peers in advisory roles.

## Build order

1. **Recurring-lesson report** (ticket 01). Read-only; useful on its own.
2. **Rule replay** (ticket 02). The evidence engine for track A.
3. **The steward and track A end to end** (ticket 03): role, schedule, ledger bundle, challenge, sign-off. Its acceptance run is the milestone: the batching lesson found unprompted.
4. **Paired program runs** (ticket 04). The evidence engine for track B; the riskiest ticket: model variance and cost decide whether the measurements mean anything.
5. **Track B through the steward** (ticket 05).
6. **Retirement report** (ticket 06).

Rules first because their evidence is cheap and their first target is already known; programs second because their evidence costs model time and the post-codemode usage that would justify them is only a day old.

## Decisions (operator, 2026-11-05)

1. **Cadence:** no schedule. An explicit slash command starts a steward run.
2. **Program spend:** the steward estimates a paired evaluation's cost and asks the operator before each one. No fixed limit.
3. **Programs stay per repository.** No user-global programs directory.
4. **Harness guards are in scope** as ordinary reviewed changes, and **each candidate lands as a ledger bundle** opened as a sign-off page (approved with the proposal).

## What is not claimed

Replay shows what a rule would have done on recorded actions; it does not show future behaviour or that the recorded mistakes were the important ones. Paired runs on a handful of tasks show an effect on those tasks with that model, not in general.

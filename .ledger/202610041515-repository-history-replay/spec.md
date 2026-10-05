# REM: Replay, Evaluate, Mutate

Status: draft spec (2026-10-04). Decisions come from the operator; see `notes.md` sections 9 and 10. Open points are marked **Open**.

REM is how the harness (Apple Pi's agent environment: its instructions, skills, and tools as they act in a repository) improves itself in a repository. Named after the sleep phase in which the brain replays the day, and inspired by Dream-RSI (https://www.dream-rsi.com/): REM **replays** past ledger tasks with a simulated user, **evaluates** the current harness against a proposed change on a fixed scorecard, and **mutates** the harness when the change is better on that evidence and the user approves it.

## 1. Goal and acceptance criteria

The feature is complete when:

- **R1.** In any repository (or parent directory) with closed ledger tasks that have `history.json` and local transcripts, `/rem` builds the set of replayable tasks and says which tasks it skipped and why.
- **R2.** A replay of one task runs the agent in a clean copy at the task's start commit, with a simulated user who plays the original user from the original transcript, and ends with a scorecard.
- **R3.** A model proposes one change to the repository's `AGENTS.md` or project skills from past histories, with its rationale.
- **R4.** REM replays the same tasks with the current harness and with the proposed change, and reports both scorecards side by side.
- **R5.** REM recommends adoption only when the change is no worse on any measure and better on at least one (section 6). Adoption is a patch the user approves; REM never edits the harness on its own.
- **R6.** After adoption, REM reports whether later real tasks improved on the same measures (transfer check).
- **R7.** Every run records what it did, what it cost, and the evidence for its recommendation.

## 2. Terms

| Term | Meaning |
|---|---|
| `history.json` | The pointer file the ledger extension keeps in each task bundle: linked Pi session IDs and the commits at `in-progress` and close (see the History section of `docs/ledger.md`). |
| World | One closed ledger task that REM can replay: its goal, start and close commits, linked transcripts, and oracle tests. |
| Oracle tests | Test files the task added or changed between its start and close commits that fail on the start commit (with their final version) and pass on the close commit. |
| Simulated user | A model that plays the original user during a replay, from the original transcript. |
| Harness variant | The current harness with one proposed change to `AGENTS.md` or a project skill applied. |
| Baseline | The current harness, unchanged. |
| Scorecard | The measures of one replay (section 5). |

## 3. Worlds

Built from each closed bundle under `.ledger/history/`:

- **Start commit**: the `in-progress` commit entry in `history.json`; **close commit**: the `done` entry. Tasks without both, or `cancelled` tasks, are skipped.
- **Goal**: the snapshot of `task.md` that capture stores in `history.json` when the task moves to `in-progress`. A ledger can be uncommitted, ignored, or above the repository, so the snapshot is the only reliable record of the goal at the start; capture must add it (first ticket). The simulated user's first message comes from the transcript, so the snapshot serves as context.
- **Transcripts**: the linked sessions that still exist in the local Pi session store. A world needs the root session that started the work; children are evidence for the proposer.
- **Oracle tests**: computed as in `components/history-eval/` (fails on start with the final test version, passes on close). A world without oracle tests is skipped.
- Parent-directory ledgers: each commit entry names its repository; a world spans the repositories its entries name.

## 4. Replay with a simulated user

1. Make a clean copy of each repository at the start commit, holding only history up to it (as `history-eval` does).
2. Apply the harness variant, if any.
3. Start a real agent session there with the repository's normal harness.
4. The simulated user sends the original first user message.
5. After each agent turn, the simulated user reads the original transcript's user messages and the new run so far, and does one of:
   - answer the agent's question as the original user would;
   - steer when the run drifts from what the original user wanted, using the original later messages as evidence of intent (each steer counts as a **correction**);
   - accept when the agent reports the work done in a way the original user would have accepted;
   - give up when the run cannot reach the goal within the limits.
6. The run ends on accept, give-up, or a limit. Score it (section 5).

The simulated user never sees the oracle tests or the close commit.

Fidelity (operator decision, 2026-10-04): a replay cannot reproduce the original messages, because the model is stochastic and the new run diverges. The simulated user reads the user's side of the original transcript, infers the underlying intent, and feeds that intent back as faithfully as it can. Where the run reaches nearly the same point as the original, it may send nearly the same message; elsewhere it acts on the inferred intent. There is no calibration step in this version; the gains REM looks for are large enough to show through this noise.

## 5. Scorecard

Per replay:

- **Solved**: every oracle test passes on the final state. This is the gate.
- **Turns**: agent turns until accept or the end.
- **Corrections**: simulated-user steering messages.
- **Cost**: tokens and estimated price, the simulated user and reviewer excluded.
- **Convention findings**: material findings of a standards review of the final diff against the repository's `AGENTS.md` and docs (the code-review skill's standards lens, on a model profile).

Repeated replays of the same world are summarized by medians.

## 6. Mutate

- **Proposer**: a model reads recent worlds' transcripts and scorecards, the current `AGENTS.md`, and the project skills, and proposes one change as a patch, with its rationale and the measure it expects to improve.
- **Scope**: the repository's own `AGENTS.md` and its project skills. User-level and package skills are out of scope for this version.
- **Evaluate**: replay the same worlds with the baseline and with the variant, the same number of times each.
- **No regression**: recommend adoption only when, on the median per world and then over all worlds, the variant's solved count is at least the baseline's, no other measure is worse, and at least one is better. Otherwise report why not.
- **Adopt**: show the patch and the evidence; on the user's approval, apply and commit it. The adopted change and its evidence are recorded.
- **Transfer check**: on later `/rem` runs, compare the measures of real tasks closed after the adoption with those closed before it, from their transcripts.

## 7. Surface and configuration

- `/rem` is a Pi command in the shipped package, root sessions only. It runs in the foreground until done (operator decision, 2026-10-04). **Open:** subcommands (for example `run` and `adopt`).
- The runner moves from `components/history-eval/` into the shipped REM component.
- Configuration (user-level with trusted project override, like other features; no built-in values): model profiles for the simulated user, proposer, and reviewer; replays per world; which worlds (all, or the most recent N); per-replay limits; a spending limit per run. The operator sets every value.
- A run's report, scorecards, and proposed patch live in a `.rem/` directory next to the `.ledger/` it reads (operator decision, 2026-10-04), one directory per run. As with `.ledger/`, the repository owner decides whether it is committed or ignored.

## 8. Privacy and trust

- Operator decision (2026-10-04): the simulated user and the proposer may send transcript content to the user's own model profiles. Record this exception in `AGENTS.md` and the REM docs.
- Transcripts stay in the local Pi session store; nothing from them goes into repository files except the proposed patch and the run's report, which the user reviews.
- REM never applies a change without the user's approval.

## 9. Delivery

The first ticket extends capture: `history.json` stores the `task.md` snapshot at `in-progress`. The next is a tracer bullet that proves the premise end to end on one world: `/rem` replays one closed task with the baseline harness and the simulated user, and writes its scorecard. Later tickets add variants and evaluation, the proposer, the no-regression recommendation and adoption, and the transfer check.

No world exists yet: capture began on 2026-10-04, so the first world is the next ledger task that runs from `in-progress` to `done` with capture active and adds tests. Until then the tracer bullet can be proven only with scripted models.

## 10. Out of scope for this version

- Changing user-level `AGENTS.md`, package skills, prompts, or tools.
- Policies that only react to recorded events, which a transcript replays for free without a model ("level 1" in `notes.md` section 5).
- Proposing several changes at once.

# Cold read of the operating frame

By Odile Mizrahi (new team member), 2026-11-04, reading the captured prompt at `e2db6816` (before the ledger and wiki sections were folded into the record room). Saved by Tadhg: her role has no write tool, and `pi_exec` failed in her session with the same type error as in Tadhg's.

## Reading conditions

She read `current-prompt/system-prompt.md` in order, closely through goal-flow, and skimmed the rest; no repository source, docs, other ledger files or skill bodies. Her session already held a similar operating prompt, so she cannot claim zero exposure to the vocabulary. The scenario answers are proposed actions, not actions performed.

## Scenario answers (summary)

1. **New goal, a flaky test.** `take_task`; read `task.md`; `notes`, wiki entry pages, the ledger, context files, then code; `bash` to reproduce with `expect`; `edit`, focused checks; acceptance as in 3. Cited: "Take it as a task", "Find what is already known", "Set `expect` on a command that tests a belief". Supplied by her: how to make a flaky failure reproducible.
2. **Old code also passes.** Inspect the command and conditions, `update_notebook`, revise the check, report in the thread. Cited: "when the result surprises you, the belief was wrong", "A check that cannot fail proves nothing". Her qualification: for a one-in-ten failure, one old-code pass refutes the expectation for that run, not the bug hypothesis; the frame does not draw that distinction.
3. **Fix done.** Checks, `review_code`, `read_review`, `resolve_finding` (a fix counts only on a new capture), `sign_off_code` when operator judgment is needed, `link`, durable homes for learnings, `finish_task`, `ledger_status`. Unclear: the order of `finish_task` and ledger closure, and where a small non-ledger task's retrospective lives.
4. **A colleague names the bug.** A lead, not a cause: ask for their evidence, read the code, test the mechanism. Cited: "**Told** ... A lead to check, not a fact." Clearly taught.
5. **A week of resumable work.** Check the ledger index; `promote_task` the held task or `ledger_add`; keep `task.md` current with `ledger_status`. The toolbox alone did not explain promotion versus creation; the then-separate ledger section did.
6. **An operator decision between two designs.** Finish unaffected work, then `ask_user_question`; a sign-off page when a written plan needs review; `escalate` for authority without urgency. Unclear: questionnaire versus browser approval when both fit.
7. **Order of two workers.** The formal-verification skill, a TLA+ model, `tlc_check`, `tla_symbolic_check` when unbounded. Clearly taught, including the never-stepped action. Not taught: that a pass is evidence about the model, not automatically about the real workers.
8. **What the organization knows about billing.** `notes`, `search_messages`, `read_thread`, `experience`, then `directory` and `send_mail`; the wiki if billing is in this project. Clear at the level of purpose.

## Did it form a coherent world?

Mostly yes. It clicked at "He or your manager brings goals; you turn a goal into a result they can use", and became actionable in the goal flow. Immediate interruption versus waiting mail, interns versus colleagues versus programs: each has a distinct place. It turned list-like in the staffing and analytics paragraph and the operator's desk: capabilities exist, but not which observation makes you reach for each. The record room gave stores purposes but asked her to hold many overlapping choices at once.

## Where she reread, guessed or reconciled

1. **Seen versus Reported.** "Seen: you ran it or read it yourself" versus "Reported: a tool's result": almost everything she runs arrives through a tool. Is a test exit code seen or reported?
2. **"From most to least authoritative ... moves outward."** What is outward? The ranking read as if task goals were less authoritative than wiki notes even for scope. These are different kinds of authority, not one scale.
3. **"A top-level read brings it along; a read inside a program does not."** "Top-level" arrives before programs are explained.
4. **"Open learnings keep a ledger task from closing."** Enforcement or duty? Which learnings?
5. **`task` (background work) versus "a goal you hold is a task".** The same word for two lifecycles.
6. **"Keep going ... without waiting for approval"** versus a later "build once he approves" (from project instructions): fine after initial direction, but that boundary is not stated.
7. **"Small, coherent work needs none" (the ledger section) versus "Take it as a task".** Reads as a contradiction unless "none" means a ledger task.
8. **Reflection.** Are the edit reflection and the `update_self` reflection the same, and when is a result final?

## Tools whose purpose or boundary stayed unclear

`economics` versus `predictions`; choosing among `progress`, `bottlenecks` and `coordination`; `canvas`/`canvases` versus files, notes and sign-off documents; where `activity_rule` routes; `promote_task` versus `ledger_add` (from the toolbox alone); `note` versus `update_notebook`, and when a learning moves between them.

## The one change that would help most

One compact worked lifecycle right after the preamble: a bug report becomes a task; evidence disproves an assumption; the fix gets independent review; the operator decides where needed; the task closes with evidence and a durable learning. Label which tool changes which record, and show the ledger branch for resumable work. The existing goal flow could become this example instead of adding a layer. "My main difficulty was not understanding what the organization is, but selecting between adjacent doors and knowing which state each leaves behind."

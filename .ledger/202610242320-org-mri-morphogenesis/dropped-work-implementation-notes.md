# Ticket 13 implementation notes

These notes guide the implementation of [Spend on dropped work](tickets/13-spend-on-dropped-work.md); they are a source-based plan, not a claim that ticket 13 is built. The result should explain compute and delay already counted on tasks later cancelled or explicitly replaced, without changing the fitness total or judging that the work was wasteful.

Here, **focus** is the one task selected for a person, not all their assignments. **Observation time** is when the runtime recorded a cumulative cost increase, which can be later than the actual inference during an outage. **Eligible tasks** are the task set the fitness adapter already admits; temporary-peer-only internal steps remain excluded.

Source locations below are under `components/session-state/src/`.

## Reuse recorded focus changes

- work.ts changeWork records command_id/task_id/person/action in work_changes for take, assign, focus, finish and unassign.
- runtime.ts applyWork is the only production caller. It atomically posts task-thread message id commandId + ':post', at the same execution time, before committing. Join that retained message to work_changes for focus transition timestamps. Do not infer from current work_focus.
- take/assign/focus set focus; finish clears it; unassign clears it only if that task was focused. A prior focus before the requested window must still be replayed. promote does not alter focus.
- program-peers deletes work_changes/thread messages only for tasks actually deleted; retained task posts already survive. Known missing old facts are not a reason to invent focus telemetry.

Derive explanatory spend from existing evaluated economic events only. Dollar total remains unchanged. Delay already uses task:<id> sources; compute uses person:<id> and requires estimated task attribution from focus at observation time. Compute without known focused eligible task is unattributed, not guessed as dropped. Retain existing organizational/task eligibility.

A supersedes link points from replacement to replaced task. It changes no dollars itself. Closed cancelled tasks and explicitly replaced tasks are the dropped-work evidence; preserve those references and avoid a verdict that dropping was wasteful. Classification of historical spend by a later known cancellation/replacement is an annotation, not economic restatement. Native wording must make its time convention clear.

## Implementation and checks

Replay the retained focus transitions, attribute existing compute events at their observation times, and report task-level explanatory amounts plus unattributed compute. Keep the existing pure evaluator unchanged.

Acceptance from [ticket 13](tickets/13-spend-on-dropped-work.md) remains authoritative: cancelled task focused during $12 spend, superseded task's compute/delay versus no link, and no-focus spend reported unattributed. Add focus-before-window, changing focus/clear, unchanged total and no double counting. Do not change evaluate or persist another focus ledger.

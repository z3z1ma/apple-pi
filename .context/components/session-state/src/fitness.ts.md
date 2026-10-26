## file

`evaluate` is the pure evaluator U: it knows only economic events and a window, never the database, scenarios, or roles. Every event is a point charged when `from <= at < to`, or an interval charged by its overlap, which is what makes any split of a window add up (partition invariance). The history adapter turns recorded facts into events; later a scenario adapter feeds the same evaluator, so realized and expected fitness stay one function.
Why: the spec requires expected fitness to be the same arithmetic as realized fitness; a second calculator for scenarios would drift. An earlier draft charged a task's whole delay at completion, which double-counted delay across windows.
The adapter reads valuations from the current `task.md` on every call (repricing restates history, as the operator ruled) but reads opens and closes only from the runtime's records, so archiving a bundle does not change past windows. Tasks without an `opened_at` are not obligations.
`realizedFitness` evaluates any window it is given, and an open task's delay runs to the window's end. The `fitness` tool refuses a window ending after now.
Why: a future end would count delay that has not happened as realized; expected fitness for the future belongs to scenarios.
Ephemeral tasks held only by temporary `pi_exec` peers never count, before or after the program discards those peers; the adapter excludes the same set `discardProgramPeople` deletes, so disposal changes no window. A temporary peer's work is a step inside its caller's task, not an obligation of the organization. If a program's spend must ever count, it belongs to the caller's task.
Why: counting them while the peers lived and losing them at disposal made the same past window read $45 and then $0 in review.
Coupled: components/session-state/src/valuation.ts, components/session-state/src/work.ts, components/session-state/src/work-tools.ts, components/session-state/src/program-peers.ts
Verify: components/session-state/tests/fitness.test.ts, components/session-state/tests/work.test.ts

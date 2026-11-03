---
name: formal-verification
description: "Model-check a state machine with TLA+ and TLC. Use for crash recovery, replay, concurrent lifecycle transitions, or an invariant whose failure depends on an ordering of events."
---

# Formal verification

Find a failing ordering before it reaches production. Deliver a source-mapped state machine, a reproducible TLC configuration, and either a checked finite model or a counterexample with an implementation-level regression test.

## Choose the boundary

Use a model when correctness depends on which transition happens first: journal commits and receipts, restart and replay, ownership transfer and cleanup, cancellation and completion. Use ordinary tests for a local calculation or one input/output case. Choose the smallest boundary that retains the competing events and the failure mechanism.

State the claim in observable terms. Separate safety (something bad never happens) from liveness (something eventually happens). An eventual-completion claim needs explicit scheduling, availability and crash assumptions. A safety check can explore repeated crashes without assuming recovery eventually runs.

## Derive the model from the implementation

Read the code, its `.context` invariants where present, the governing intent and the relevant tests. Identify the actual writers, durable stores, transaction boundaries, queues and observers. Trace startup and error paths as well as the success path. Map every modeled action to its implementation owner in the model's companion document.

Represent durable state separately from volatile state. Make a transaction one durable transition, with volatile intermediate phases where a crash can occur. Preserve separate stores as separate transitions: a database commit and a transcript or filesystem write are different events. Model acknowledgments and retries independently from effects. Keep the identity and deduplication rule the implementation actually uses.

Write `Init`, `Next` and named invariants in `specs/<system>.tla`, with the finite instance and checked properties in its `.cfg`. Choose bounds that distinguish the cases being claimed, such as one identity retried versus two different identities interleaved; explain the choice. Record each abstraction and excluded behavior. Model the current implementation first; keep a proposed repair or deliberately broken control labeled separately.

## Run the checker

Call `tlc_check` with the `.tla` path (and `config` when the `.cfg` is not beside it). It runs TLC with a pinned, checksummed `tla2tools.jar` (downloaded on first use; needs Java) and returns a verdict: `pass`, `violation` with the property name, `deadlock`, or `error`. A violation or deadlock comes with the counterexample as numbered states, each with its action and variable values, plus state counts and depth. One module plus the standard TLA+ modules is supported; the declared module name may differ from the file name.

[`examples/lost-update.tla`](examples/lost-update.tla) is a small model to try first: two workers read a counter and write back the value plus one, and `tlc_check` finds the interleaving that loses an update.

Require a `pass` with no states left on the queue, not merely a parsed spec or a stopped search. Retain the spec, configuration, tool version, state counts and verdict. A deliberately broken model should come back as a violation with a trace; this checks that the check can detect violations rather than accept every model.

## Counterexample-to-test loop

For each counterexample from the implementation model, map the shortest trace to actual calls, writes, commits or crash boundaries. Translate it into an ordinary behavioral test in the repository's own framework, against the real implementation. Keep scheduling and snapshot controls explicit, and preserve the implementation's authority and transaction guards.

Use the intended behavioral assertion as the oracle:

- **Fails for the modeled ordering:** report the defect with its trace, failing test and scope before fixing it. Make an authorized repair at the shared owner, then rerun the test and model.
- **Passes:** refine the abstraction from source and rerun TLC, preserving the implementation assertion.
- **Setup, loader or model error:** repair the harness or model, then reach the intended assertion before classifying the trace.

Keep an iteration record: source/model revisions, abstraction changes, checker command/configuration/version, trace, test command, outcome and elapsed time. Measure time-to-candidate and time-to-clean-reproduction separately from the start of the investigation, including source reading and harness repair. Retain evidence outside disposable checker state so another session can reproduce the result.

State what the test exercised: a seeded snapshot proves recovery from that snapshot; a controlled crash proves the particular interruption. Classify a deliberately faulty model as a checker control, and a completed finite search as evidence within its declared bounds.

## Done

The source mapping and assumptions are reviewable, TLC exhausts the declared finite instance, the failure control is detected, and any confirmed implementation counterexample has been reported. Report the exact checked bounds and unmodeled behavior. A passing abstract finite model is evidence about those transitions, not a proof of the whole implementation or all population sizes.

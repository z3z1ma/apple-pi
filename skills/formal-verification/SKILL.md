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

Read the code, its `.context` files, the governing intent and the relevant tests. Identify the actual writers, durable stores, transaction boundaries, queues and observers. Trace startup and error paths as well as the success path. Map every modeled action to its implementation owner in the model's companion document.

Represent durable state separately from volatile state. Make a transaction one durable transition, with volatile intermediate phases where a crash can occur. Preserve separate stores as separate transitions: a database commit and a transcript or filesystem write are different events. Model acknowledgments and retries independently from effects. Keep the identity and deduplication rule the implementation actually uses.

Write `Init`, `Next` and named invariants in `specs/<system>.tla`, with the finite instance and checked properties in its `.cfg`. Choose bounds that distinguish the cases being claimed, such as one identity retried versus two different identities interleaved; explain the choice. Record each abstraction and excluded behavior. Model the current implementation first; keep a proposed repair or deliberately broken control labeled separately.

## Run the checker

In this package, [the TLC runner](../../scripts/run-tlc.mjs) downloads a pinned, SHA-256-checked `tla2tools.jar` to the user cache and runs one worker in a disposable directory. It needs Java (the repository uses Java 21). Run:

```bash
node scripts/run-tlc.mjs specs/command-journal.tla
npx vitest run tests/formal-verification.test.ts --maxWorkers=1
```

The Vitest command requires a development checkout; tests and dev dependencies are not shipped. In an installed package, run from this skill's directory instead:

```bash
node ../../scripts/run-tlc.mjs ../../specs/command-journal.tla
```

An optional second runner argument selects another `.cfg`. The runner supports one module plus the standard TLA+ libraries; it stages the declared module name so kebab-case repository paths remain valid. See the [command journal model](../../specs/README.md) for a worked source mapping and proof boundary.

Require a completed state-space search with no remaining queue and successful exit, not merely a parsed spec or a timed-out search. Retain the command, configuration, tool version, state counts and result. A deliberately broken model should produce a failing exit and trace; this checks that the test can detect violations rather than accept every invocation.

## Turn a counterexample into evidence

Read the shortest trace and map every step back to an actual call, write, commit or crash boundary. Challenge the abstraction: a trace may expose a modeling error or an environmental assumption rather than a product defect. Report a source-supported implementation counterexample, with its trace and scope, before changing the implementation.

Translate a confirmed trace into a focused behavioral test using the repository's existing harness. Make the real implementation fail for that ordering, then make an authorized repair at the shared owner and rerun the test and model. A seeded durable snapshot proves recovery from that snapshot; a controlled crash proves the specific interruption exercised. State which one ran.

## Done

The source mapping and assumptions are reviewable, TLC exhausts the declared finite instance, the failure control is detected, and any confirmed implementation counterexample has been reported. Report the exact checked bounds and unmodeled behavior. A passing abstract finite model is evidence about those transitions, not a proof of the whole implementation or all population sizes.

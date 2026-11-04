---
name: formal-verification
description: "Model-check or prove what a system must guarantee: orderings of events in TLA+ (TLC, Apalache), structural constraints in Alloy, laws of functions in Lean. Use for crash recovery, replay, concurrent lifecycle transitions, ownership, reference and graph invariants, or algebraic laws such as an idempotent merge."
---

# Formal verification

Find a failing ordering, configuration or input before it reaches production. Deliver a source-mapped model or theorem, a reproducible check, and either a passing verdict within stated bounds or a counterexample with an implementation-level regression test.

## Choose the engine

| The claim is about | Engine | Tool |
| --- | --- | --- |
| How state evolves: concurrency, crash and replay, retries, lifecycle transitions | TLA+ | `tlc_check`, `tla_symbolic_check` |
| How things relate: ownership, cardinality, references, reachability and cycles, permissions, cleanup leaving no dangling reference | Alloy | `alloy_check` |
| What a function guarantees for every input: idempotence, commutativity, associativity, conservation, monotonicity | Lean | `lean_check` |

The engines overlap (Alloy 6 has mutable state, TLA+ can state relational invariants, Apalache proves inductive invariants), so choose by which one states the claim most plainly. A natural split: Alloy checks that the object model's rules admit no malformed configuration, TLA+ checks that every operation preserves those rules over time, and Lean proves the laws of the pure functions inside.

State the claim once, in observable terms, before any model or proof, so a reviewer can judge it apart from the work that checks it. Never treat agreement between engines as proof: models written by one author share that author's assumptions. Each verdict covers its own model, scope or theorem.

## Choose the boundary

Use a model when correctness depends on which transition happens first: journal commits and receipts, restart and replay, ownership transfer and cleanup, cancellation and completion. Use ordinary tests for a local calculation or one input/output case. Choose the smallest boundary that retains the competing events and the failure mechanism.

State the claim in observable terms. Separate safety (something bad never happens) from liveness (something eventually happens). An eventual-completion claim needs explicit scheduling, availability and crash assumptions. A safety check can explore repeated crashes without assuming recovery eventually runs.

## Derive the model from the implementation

Read the code, its `.context` invariants where present, the governing intent and the relevant tests. Identify the actual writers, durable stores, transaction boundaries, queues and observers. Trace startup and error paths as well as the success path. Map every modeled action to its implementation owner in the model's companion document.

Represent durable state separately from volatile state. Make a transaction one durable transition, with volatile intermediate phases where a crash can occur. Preserve separate stores as separate transitions: a database commit and a transcript or filesystem write are different events. Model acknowledgments and retries independently from effects. Keep the identity and deduplication rule the implementation actually uses.

Write `Init`, `Next` and named invariants in a `<system>.tla` file, with the finite instance and checked properties in its `.cfg`. Choose bounds that distinguish the cases being claimed, such as one identity retried versus two different identities interleaved; explain the choice. Record each abstraction and excluded behavior. Model the current implementation first; keep a proposed repair or deliberately broken control labeled separately.

## Run the checker

Call `tlc_check` with the `.tla` path (and `config` when the `.cfg` is not beside it). It runs TLC with pinned, checksummed tools (downloaded on first use; needs Java) and returns a verdict: `pass`, `violation` with the property name, `deadlock`, `incomplete` or `error`. A violation or deadlock comes with the counterexample as numbered states, each with its action and variable values, plus state counts and depth. A spec can split into modules in its directory, under any file names, and can extend the TLA+ Community Modules (`SequencesExt`, `FiniteSetsExt`, `Functions`, `Folds`, `Relation`, `Graphs` and others).

Grow confidence by growing bounds. Start at the smallest instance that separates the cases, then raise `constants` run by run (`{"Workers": "{w1, w2, w3}"}`) under a `timeLimit`, without editing the `.cfg`. When a state space is too large to exhaust, `mode: "simulate"` samples long random behaviors and `mode: "depth-first"` checks every behavior up to `depth` steps; both report `incomplete` when they find nothing. Pass extra `invariants` or `properties` to check a new claim against the same model.

[`examples/lost-update.tla`](examples/lost-update.tla) is a small model to try first: two workers read a counter and write back the value plus one, and `tlc_check` finds the interleaving that loses an update.

### Beyond finite bounds

TLC enumerates states, so it checks only the finite instance you configure. Call `tla_symbolic_check` (Apalache) when that is not enough: large or unbounded integers, constants that should range over every value, or a claim that must hold for behaviors of any length. It reads the same spec and `.cfg`, but needs a type annotation before every `CONSTANT` and `VARIABLE`, such as `\* @type: Int;` or `\* @type: Str -> Set(Int);`; the example shows them.

- **Bounded** (default): every behavior up to `length` steps, for every constant value a `constInit` operator allows (`ConstInit == N \in Nat /\ N > 0`). It returns `pass` only when no behavior is longer than `length`.
- **Inductive**: a proof for every reachable state and every behavior length. Write an inductive invariant that constrains every variable with `=` or `\in`, holds initially, is preserved by every step and implies the target invariant; pass it as `inductive` and the target as `invariants`. A counterexample from the step check starts from a state that may be unreachable: strengthen the inductive invariant to exclude that state, or, if the state is reachable, you have found a real bug.

Use TLC first: it is faster on small instances and needs no annotations. Move to the inductive proof when a property matters enough to hold for every size.

Require a `pass`, not an `incomplete` search or a parsed spec. Treat any action listed as never taking a step as a modelling error: an invariant that holds because nothing happens proves nothing. Retain the spec, configuration, tool version, state counts and verdict. A deliberately broken model should come back as a violation with a trace; this checks that the check can detect violations rather than accept every model.

## Structure with Alloy

Write signatures for the entities, fields for their relations, and `fact`s for the rules the implementation enforces (unique ownership, no self-reference, deleted rows hold no references). Derive each fact from the code that enforces it, such as a schema constraint, a guard or a transaction, and map each fact to that owner in the model's companion document. State each claim as an `assert` and `check` it with a scope (`check Acyclic for 5`); add a `run` that asks for an interesting instance, so you see the facts still admit the cases you care about.

Call `alloy_check` with the `.als` path. It runs every command (or the `commands` you name), and returns `pass` only when every property check found no counterexample, every `expect` held, and some run found an instance; `violation` with the counterexample's atoms, relations and skolems; `incomplete` when nothing shows the facts are satisfiable (facts that rule out everything make every check hold vacuously), when a run without `expect` finds no instance, or when the time limit stops it; or `error` with the parse or type error. A temporal model (`var` sigs) comes back state by state, with the loop state marked. Grow the scope run by run under a `timeLimit`; a `pass` is evidence within that scope only.

Put a negative control in the model itself: a check with `expect 1` must find its counterexample, such as the claim with its enforcing fact removed. A control counts toward the verdict only by failing; it never stands in for a property check. [`examples/dependency-graph.als`](examples/dependency-graph.als) is a small model to try first: its only rule forbids a task that depends on itself, and `alloy_check` finds the two-task cycle that rule misses.

## Laws with Lean

Write a reference model of the function in Lean, in the same shape as the implementation, and state each law as a `theorem`. Call `lean_check` with the `.lean` path. It reads what the file declares from Lean's own environment, and returns `pass` only when the file has no errors, no declaration depends on `sorry`, and every theorem (or every one you name in `theorems`) depends only on the standard axioms (`propext`, `Classical.choice`, `Quot.sound`); `native_decide` and declared `axiom`s make it `incomplete`. A proof that does not go through is an `error` with Lean's message: it shows that this proof failed, not that the law is false. To show a law false, prove its negation for a concrete input.

Inside a Lake project the tool uses the project's toolchain and dependencies (Mathlib included, once the project has fetched or built them); pass `build: true` when the file imports the project's own modules. A lone file uses a pinned Lean with its core library. [`examples/merge.lean`](examples/merge.lean) proves the laws of a priority merge.

A Lean proof is about the Lean definition, not the production code. Bridge them with tests: run the implementation and the reference model on the same generated inputs and require equal outputs, or test the proved laws directly against the implementation (property-based where the repository has it). Mutate a theorem into a false statement once and confirm `lean_check` refuses it.

## Counterexample-to-test loop

For each counterexample from the implementation model, map the shortest trace to actual calls, writes, commits or crash boundaries. Translate it into an ordinary behavioral test in the repository's own framework, against the real implementation. Keep scheduling and snapshot controls explicit, and preserve the implementation's authority and transaction guards.

Use the intended behavioral assertion as the oracle:

- **Fails for the modeled ordering:** report the defect with its trace, failing test and scope before fixing it. Make an authorized repair at the shared owner, then rerun the test and model.
- **Passes:** refine the abstraction from source and rerun TLC, preserving the implementation assertion.
- **Setup, loader or model error:** repair the harness or model, then reach the intended assertion before classifying the trace.

Keep an iteration record: source/model revisions, abstraction changes, checker command/configuration/version, trace, test command, outcome and elapsed time. Measure time-to-candidate and time-to-clean-reproduction separately from the start of the investigation, including source reading and harness repair. Retain evidence outside disposable checker state so another session can reproduce the result.

State what the test exercised: a seeded snapshot proves recovery from that snapshot; a controlled crash proves the particular interruption. Classify a deliberately faulty model as a checker control, and a completed finite search as evidence within its declared bounds.

## Done

The claim, source mapping and assumptions are reviewable, the checker covers the declared instance, scope or theorem, the failure control is detected, and any confirmed implementation counterexample has been reported. Report the exact checked bounds, scopes or theorems, and the unmodeled behavior. A passing abstract model is evidence about those transitions or configurations, and a Lean proof about its reference definition; neither proves the whole implementation.

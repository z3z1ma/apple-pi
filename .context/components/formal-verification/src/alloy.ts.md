## file

Each selected command runs in its own `exec -c <index>` with its own output directory. Alloy's receipt and solution files are keyed by command name, so two commands with the same name would overwrite each other in one run; a JVM start costs about half a second per command.

A command's result is trusted only when the receipt names the requested solver and holds exactly one entry, keyed and named as the listing names the command, of the command's type, with no `transformPath`, and either no `solution` (no instance) or a nonempty array of solutions with instances; and the process exited 0, or exited 1 with Alloy's line `N. '<Kind> <name> ...' was (not) satisfied against expectation` for a command that declares `expect`, consistent with the receipt. Anything else is an error. A missing `solution` means no instance only under those conditions: export backends (CNF, KK) write receipts without one, which is why the solver is restricted to solving backends.

Each command re-reads the spec and its opened modules in its own JVM, so a fingerprint of every `.als` file under the spec's directory (paths and contents) taken before the listing must match after the last command; a model edited mid-check is an error. Modules opened from outside that directory are not covered.

Expectations come from the `commands` listing (`... expect N`), not the receipt: the pinned receipt writer omits zero-valued fields, so `expect 0` has no `expects` field at all.

Verdict, in order: violation for a property check (no `expect`, or `expect 0`) with a counterexample, or any command whose result its `expect` did not predict. Incomplete when a command did not run, a run without `expect` found no instance, no property check ran, or no run found an instance. A `check ... expect 1` is a control: finding its counterexample only keeps it from being a violation. Pass needs a run with an instance because contradictory facts make every check hold vacuously; that run's scope may differ from a check's, so the witness is evidence about satisfiability, not proof of it in every checked scope.

Instances use Alloy's text output; the builtin `univ`, `Int`, `seq/Int`, `String` and `none` lines and the `this/` prefix are dropped, and a model without `var` drops the state header (static instances are printed as one looping state); a temporal model keeps every header, so a single looping state still shows its loop.

`specs/alloy-decision.lean` transcribes `execute`, `judge` and `runAlloy` and proves what a `pass` guarantees for any list of commands; change it with them.

Coupled: components/formal-verification/src/index.ts, components/formal-verification/src/toolchain.ts, skills/formal-verification/SKILL.md, skills/formal-verification/examples/dependency-graph.als, specs/alloy-decision.lean
Verify: components/formal-verification/tests/alloy.test.ts, tests/verification-models.test.ts

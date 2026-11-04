## file

Each selected command runs in its own `exec -c <index>` with its own output directory. Alloy's receipt and solution files are keyed by command name, so two commands with the same name would overwrite each other in one run; a JVM start costs about half a second per command.

The outcome comes from `receipt.json` (a command with a `solution` found an instance), not from exit codes: Alloy exits 1 when a command misses its `expect` but still writes the receipt. Only a missing receipt means the command failed or was stopped.

Verdict: a check's counterexample or any result its `expect` did not predict is a violation. A run with no instance and no `expect` does not change the verdict; the tool report flags it as a vacuity warning, since Alloy itself treats only `expect` as pass or fail.

Instances use Alloy's text output; the builtin `univ`, `Int`, `seq/Int`, `String` and `none` lines and the `this/` prefix are dropped.

Coupled: components/formal-verification/src/index.ts, components/formal-verification/src/toolchain.ts, skills/formal-verification/SKILL.md, skills/formal-verification/examples/dependency-graph.als
Verify: components/formal-verification/tests/alloy.test.ts

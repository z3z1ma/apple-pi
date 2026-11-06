## file

Script rules run in Pi codemode's `InlineCodemodeSandbox` (QuickJS in-process, no tools, no file system, network or timers), the sandbox family saved programs use. All scripts of one rules directory and all events of one check run in a single execution. Events enter as JSON strings and each rule parses its own copy, so a rule that mutates its event cannot change what a later rule sees; a throw is caught per rule and event. When the whole program fails to parse, each rule is run alone so one broken rule reports its own error instead of hiding the others.
Why: measured on this machine, an inline execution costs about 4 ms and the out-of-process `CodemodeSandbox` about 20 ms; checks run before every tool call.

Rules and results travel as `[id, ...]` arrays and come back as a `Map`, never as object keys, so any id works (`__proto__` included).

There is no glob helper in the sandbox: `includes` (Node's `matchesGlob`, shared with code rules) is the one glob dialect.
Why: a hand-written helper disagreed with `includes` on braces, classes and dotfiles (review `review-801e5cc5`).

The sandbox sets no time limit of its own (`timeoutMs: Infinity`); pi-codemode's QuickJS interrupt budget still stops a runaway script, measured at about 3 seconds for `while (true) {}`, during which the Pi process is blocked (the inline sandbox runs on the main thread). The rule then fails with "Execution exceeded its interrupt budget", which refuses the call and, when the rule is written, its sample check.
Why: choosing a cap without evidence is forbidden here (AGENTS.md); the existing bound comes from the sandbox owner.

`true` from a rule becomes its `message` (or "refused"); other values are converted to strings. The QuickJS WebAssembly module loads once per process.
Coupled: components/repo-rules/src/engine.ts, components/repo-rules/src/checks.ts, components/repo-rules/src/replay.ts, lint/repo-rules.mjs, package.json
Verify: components/repo-rules/tests/repo-rules.test.ts, components/repo-rules/tests/rules-robustness.test.ts, components/repo-rules/tests/replay.test.ts

## file

This guard stops an obvious search of a huge directory: home, `/`, or a configured root. It is not a shell interpreter and does not resist deliberate evasion.
Why: when a command is ambiguous (a variable, substitution, pipeline, wrapper, loop, function, eval, xargs, or an unresolvable `cd`), the guard fails open and lets the command run.

Callers pass an already-absolute path. `resolve` only normalizes it and never falls back to `process.cwd()`. Plain `$HOME`, `${HOME}` and `~` expansion is for JSON path fields, which have no shell quoting. A search root is blocked when it is a protected root or an ancestor of one, because searching `/` walks into home.

A heredoc body is data, not shell syntax, so its text is masked before tokenizing. The tokenizer splits on top-level `;`, `|`, `&` and newlines and respects quotes only. It does not track command substitution or parentheses. A separator inside a substitution can split too early. That imprecision is accepted.

A search command is recognized as the first word even after a glued assignment or `$(` prefix, so `result=$(grep` is still caught. `grep` takes the pattern first and then path arguments. `find` starting points end at the first expression primary. `--help` and `--version` do not traverse anything.
Verify: components/home-search-guard/tests/home-search-guard.test.ts

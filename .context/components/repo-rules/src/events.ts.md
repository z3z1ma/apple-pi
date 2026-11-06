## file

The event shapes script rules see, and the only place they are built: the live hook, rule samples (`checks.ts`), replay and lint all call `callEvent`/`editEvent`, so a rule behaves the same in each. Adding a field here is how rules learn to see more; the shapes are documented for rule authors in `docs/repo-rules.md`.

Paths are relative to the repository root (the directory holding `.pi/rules/`) and resolved as the live tools resolve them (`resolveToolPath`: `@`, `~`, `file://`); a malformed path is `null`, and its own tool reports the error. Shell paths are a literal-argument heuristic: `shellWord` owns quote and escape decoding, `shellCommands` splits on unquoted separators into one word list per simple command, and `shellPaths` handles leading assignments and `cd`. Separators are list boundaries, never words, so a quoted `;` stays an operand (review `review-801e5cc5`: a `';'` word read as a separator lost refusals). Commands with expansion, substitution, heredocs, line continuations or unsupported compound syntax, or a `cd` away from the cwd, yield no paths; `commands` is `null` for the first group. It can flag a harmless mention and miss globs, symlink aliases and indirect dependencies: a workflow guard, not a security boundary.
Why: these limits were part of the operator's adoption of the dependent-batch rule (`.ledger/history/202611052330-dependent-edit-batches/`); the matcher moved here unchanged when the rule became configuration.

`addedTexts` reads every edit shape the edit tool accepts (`edits` as an array, a JSON string or one object, and legacy top-level `oldText`/`newText`).
Coupled: components/repo-rules/src/scripts.ts, components/repo-rules/src/replay.ts, components/repo-rules/src/checks.ts, lint/repo-rules.mjs, docs/repo-rules.md
Verify: components/repo-rules/tests/batches.test.ts, components/repo-rules/tests/replay.test.ts

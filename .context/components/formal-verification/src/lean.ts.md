## file

The check never edits or reads the user's file beyond its text: the source is copied to a scratch directory as module `ApplePiChecked`, compiled with `--json -o` (the file's own diagnostics, lines unchanged), and then a second file that imports `Lean` and that module lists every constant the module added, with `collectAxioms`, as marked JSON lines. Names, kinds and axioms therefore come from Lean's environment, not from parsing source; source scanning missed same-line, `set_option ... in`, string-hidden and namespace-shadowed theorems, and `#print axioms` text parsing could be fooled by a quoted name.

Which theorems are listed: theorem constants with declaration ranges (written by the user, including through macros) that are not internal names; private names are shown demangled. Theorems Lean generates (equation lemmas such as `f.eq_1`) are not listed but still fail the check if they rely on a nonstandard axiom. Every constant in the module, of any kind, fails the check if it depends on `sorryAx`, so `set_option warn.sorry false` does not hide sorry. An `example` adds no constant, so a sorry inside one is visible only through the warning.

`pass` requires both processes to exit 0 without timing out, no error diagnostic, at least one listed (or requested) theorem, no `sorryAx` anywhere, and every theorem's axioms within propext, Classical.choice and Quot.sound. A requested name must be a theorem of this file.

elan: an existing `$ELAN_HOME` or `~/.elan` is reused when it has `elan`, `lean` and `lake` launchers. Otherwise a pinned elan installs into a per-process staging directory that is renamed into the cache only when complete, so an interrupted install is never reused. The elan archive is checksummed; toolchains elan downloads are not. A first `lean --version` (untimed, cancellable) installs the toolchain; after it, one deadline covers `lake build`, `lake env`, the compile and the audit. In a Lake project (`lakefile.lean` or `lakefile.toml` up the tree) `LEAN_PATH` comes from `lake env` with the scratch directory in front; a `lean-toolchain` alone selects the toolchain; a lone file uses `LEAN_TOOLCHAIN`.

Coupled: components/formal-verification/src/index.ts, components/formal-verification/src/toolchain.ts, skills/formal-verification/SKILL.md, skills/formal-verification/examples/merge.lean
Verify: components/formal-verification/tests/lean.test.ts

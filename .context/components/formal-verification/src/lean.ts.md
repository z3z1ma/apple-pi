## file

Lean reads the file on stdin with `#print axioms <name>` lines appended, so the user's file is never changed and every diagnostic keeps its line. Messages after the original last line belong to the audit; an error there (an unknown name) means that theorem was not audited, not that the file is wrong.

Theorem names come from a line scan that strips comments and tracks `namespace`, `section` and `end`, unless the caller names them. It misses theorems produced by macros or declared mid-line; such a theorem is still covered by the file-wide `sorry` warning and error checks, only not by the axiom audit.

`pass` requires: no error diagnostic, no "declaration uses sorry" warning, at least one audited theorem, and every audited theorem's axioms within propext, Classical.choice and Quot.sound. `Lean.ofReduceBool` (native_decide) and declared axioms make it incomplete. A theorem whose proof failed shows `sorryAx` in its audit because Lean recovers from the error; the error diagnostic decides the verdict first.

elan: an existing `$ELAN_HOME` or `~/.elan` is reused, so a user's toolchains are shared; otherwise a pinned elan installs into the apple-pi cache with no default toolchain. The elan archive is checksummed; toolchains elan downloads are not. A first `lean --version` (untimed, cancellable) installs the toolchain before the time limit starts. In a Lake project (`lakefile.lean` or `lakefile.toml` up the tree) the check runs `lake env lean` from the project root; a `lean-toolchain` alone selects the toolchain; a lone file uses `LEAN_TOOLCHAIN`.

Coupled: components/formal-verification/src/index.ts, components/formal-verification/src/toolchain.ts, skills/formal-verification/SKILL.md, skills/formal-verification/examples/merge.lean
Verify: components/formal-verification/tests/lean.test.ts

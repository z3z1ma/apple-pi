## file

The harness (`components/repo-rules`) runs each listed `.grit` file as a Biome 2.5.8 GritQL plugin on every edit or write to its `includes` paths, and `biome.json` keeps a matching `overrides[].plugins` entry so `npm run lint` runs the same rule. A new rule needs both entries.

Writing GritQL for Biome 2.5.8: regex capture groups bind variables and fail at run time ("regex pattern matched 2 variables, but expected 0"), so use `(?:...)`; matching a node by regex works (`$v where { $v <: r"#[0-9a-f]{3,8}" }`); `$x <: not within <pattern> where {...}` does not compile. A plugin that fails to compile reports only "Error(s) during loading of plugins": load one `.grit` file at a time in a scratch directory with its own `biome.json` to find it.

Every code rule and action carries a `fires` sample it must flag and a `passes` sample it must allow. Code samples run as `sample.tsx`, or as `sample.css` for a `language css` rule. The harness refuses a write to `policy.json` or to a listed `.grit` file when a rule does not load or misbehaves on its samples.
Why: agents add rules liberally; a broken rule otherwise surfaced later as a confusing refusal on unrelated edits, and an over-broad rule blocked good code.
Why: each of these cost a debugging round when the first rules were written; the error messages do not name the cause.
Coupled: biome.json, components/repo-rules/src/grit.ts
Verify: components/repo-rules/tests/repo-rules.test.ts

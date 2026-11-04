## file

The harness (`components/repo-rules`) runs each listed `.grit` query on the standalone GritQL engine on every edit or write to its `includes` paths, and `npm run lint` (`lint/repo-rules.mjs`) runs the same rules over every tracked file they apply to. A rule is one entry here; nothing else lists it.

Writing GritQL for the standalone engine: every match is a violation, and the rule's `message` lives here; Biome's `register_diagnostic` does not exist there. Regex capture groups bind variables, so use `(?:...)`; matching a node by regex works (`$v where { $v <: r"#[0-9a-f]{3,8}" }`).

Every code rule and action carries a `fires` sample it must flag and a `passes` sample it must allow. Code samples are parsed in the rule's `language`. The harness refuses a write to `policy.json` or to a listed `.grit` file when a rule does not load or misbehaves on its samples.
Why: agents add rules liberally; a broken rule otherwise surfaced later as a confusing refusal on unrelated edits, and an over-broad rule blocked good code.
Why: each of these cost a debugging round when the first rules were written; the error messages do not name the cause.
Coupled: components/repo-rules/src/grit.ts, lint/repo-rules.mjs
Verify: components/repo-rules/tests/repo-rules.test.ts

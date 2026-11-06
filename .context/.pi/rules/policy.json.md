## file

The harness (`components/repo-rules`) applies everything listed here before every tool call and edit in this repository, and `npm run lint` (`lint/repo-rules.mjs`) runs the GritQL rules and edit scripts over every tracked file they apply to. A rule is one entry here; nothing else lists it. `docs/repo-rules.md` is the format.

Writing GritQL for the standalone engine: every match is a violation, and the rule's `message` lives here; Biome's `register_diagnostic` does not exist there. Regex capture groups bind variables, so use `(?:...)`; matching a node by regex works (`$v where { $v <: r"#[0-9a-f]{3,8}" }`).

Every rule carries `fires` samples it must refuse and `passes` samples it must allow. Code samples are parsed in the rule's `language`; script samples are events. The harness refuses a write to `policy.json`, a listed `.grit` file or a script file when a rule does not load or misbehaves on its samples.
Why: agents add rules liberally; a broken rule otherwise surfaced later as a confusing refusal on unrelated edits, and an over-broad rule blocked good code.

`parallel-dependents.js` and `commit-beside-edit.js` were harness code until 2026-11-06 (`components/repo-rules/src/batches.ts` and a hook in `index.ts`); the operator adopted the first through the capability steward (`.ledger/history/202611052330-dependent-edit-batches/`) and then had both moved here, as policy the repository owns. Their samples restate the adopted cases; `components/repo-rules/tests/batches.test.ts` runs the real files through the hook. Before this move the commit check applied in every repository; to keep that for yourself, copy both into `~/.pi/agent/rules/`.
Coupled: components/repo-rules/src/grit.ts, components/repo-rules/src/events.ts, lint/repo-rules.mjs, lint/README.md
Verify: components/repo-rules/tests/repo-rules.test.ts, components/repo-rules/tests/batches.test.ts, components/repo-rules/tests/batch-host.test.ts

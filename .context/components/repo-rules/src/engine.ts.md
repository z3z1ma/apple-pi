## file

The one place that applies rules. `checkCall` is what the hook calls for every tool call: for a top-level `edit`/`write` it first gathers the edit problems (comment policy, GritQL rules and edit scripts on the content the edit would produce), then action rules (on `bash`) and call scripts, and reports them all in one refusal; every rule in it is recorded as fired. `checkEdit` is the edit half alone. Each rules directory (user, then project) is evaluated on its own, and each line of a refusal names its rule.
Why: one refusal format and one firing record for every kind of rule keeps `repo_rules`, `replay_rule` and `session_evidence` (which matches refusals by the leading "Refused") consistent; returning the first refusing phase hid the others (review `review-801e5cc5`).

The proposed content comes from Pi's own edit tool (`createEditToolDefinition` with operations that read the real file and capture the write), so line-ending normalization and fuzzy matching match what the tool will write. When the edit would fail anyway, the hook leaves the tool to report its own error.
Why: an exact-match reconstruction skipped every check on edits the tool accepted after normalizing CRLF or smart quotes.

A rule that cannot run refuses with the error and names the rules directory to fix: a script that throws, does not parse or whose file is missing, a GritQL query that fails or is missing, an action pattern that does not compile, and a `policy.json` that does not parse (`RuleSet.error`), which refuses every call. A call or edit aimed at a file in a rules directory (`rulesDirOfFile`, by the file's real path) is decided before any policy is loaded and checked only by the sample check of the rules it changes, so no rule, broken or over-broad, can block its own repair.
Why: failing open lets a broken rule silently stop guarding; a rule written by shell bypasses the sample check and could otherwise refuse every edit, including the fix. Classifying by real path keeps a symlink into a rules directory from exempting an ordinary file.

Repository-relative paths are relative to the directory holding `.pi/rules/` for the edited file, else to the cwd's (`baseOf`), so user rules keep `src/a.ts` where a repository has no rules.

When this engine changes, test every state in which a rule cannot run or a path is ambiguous before review: an unparsable `policy.json`, a missing script or grit file, a pattern that does not compile, a script that throws or loops, symlinks into and out of a rules directory, object-internal ids such as `__proto__`, quoted shell separators, and edits accepted only after CRLF or fuzzy normalization. The first review found 15 defects, nearly all in these states. When rules move into or out of harness code, prove equivalence by replaying the old and the new over the same recorded batches (`sessionEntries`); the batch guard matched 229 of 229 refusals.

Refusals are recorded per rules directory root and rule in `~/.pi/agent/repo-rules/firings.jsonl` (`firings.ts`), outside the repository.
Why: rule counts are this machine's history; committing them would churn the repository.
Coupled: components/repo-rules/src/index.ts, components/repo-rules/src/checks.ts, components/repo-rules/src/policy.ts, components/repo-rules/src/evidence.ts, docs/repo-rules.md
Verify: components/repo-rules/tests/repo-rules.test.ts, components/repo-rules/tests/rules-robustness.test.ts, components/repo-rules/tests/batches.test.ts

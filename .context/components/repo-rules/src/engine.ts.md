## file

The one place that applies rules. `checkCall` runs action rules (on `bash` commands) and call scripts; `checkEdit` runs the comment policy, GritQL rules and edit scripts on the content the edit would produce (`proposedContent`), plus the sample check of a changed rules file (`ruleFileRefusal`). Each rules directory (user, then project) is evaluated on its own, and all refusals are reported together, each line tagged with its rule id.
Why: one refusal format and one firing record for every kind of rule keeps `repo_rules`, `replay_rule` and `session_evidence` (which matches refusals by the leading "Refused") consistent.

A rule that cannot run (a GritQL failure, a script that throws or does not parse) refuses with the error and names the rules directory to fix. A call or edit aimed at a file in a rules directory (`ruleSetOfFile`) is checked only by the sample check of the rules it changes: no call script, edit script, GritQL rule or comment policy applies to it, so no rule, broken or over-broad, can block its own repair.
Why: failing open would let a broken rule silently stop guarding; a rule written by shell bypasses the sample check and could otherwise refuse every edit, including the fix.

When the edit would fail anyway (text missing or not unique), the hook leaves the tool to report its own error. Repository-relative paths (`baseOf`) are relative to the directory holding `.pi/rules/`, or the cwd without one.

Refusals are recorded per rules directory root and rule in `~/.pi/agent/repo-rules/firings.jsonl` (`firings.ts`), outside the repository.
Why: rule counts are this machine's history; committing them would churn the repository.
Coupled: components/repo-rules/src/index.ts, components/repo-rules/src/checks.ts, components/repo-rules/src/evidence.ts, docs/repo-rules.md
Verify: components/repo-rules/tests/repo-rules.test.ts, components/repo-rules/tests/batches.test.ts

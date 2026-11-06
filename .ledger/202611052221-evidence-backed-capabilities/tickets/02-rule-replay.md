# 02: Replay a candidate rule over recorded actions

**What to build:** Given a candidate code rule (GritQL with its paths) or action rule (a command pattern), evaluate it against every recorded `edit`/`write` payload or `bash` command in a window of session logs, and report the actions it would have refused, each linked to its transcript entry, plus the actions it could not evaluate. A harness guard is replayed over recorded tool-call batches the same way.

**Blocked by:** None (can start immediately)

**Status:** planned

- [ ] Replaying an existing rule (for example `github-writes`) lists the recorded commands it would have refused, with links.
- [ ] Replay records no firings in `~/.pi/agent/repo-rules/firings.jsonl`.
- [ ] An `edit` whose original file content cannot be reconstructed is listed as not evaluated, not counted as a pass.
- [ ] The window defaults to the last commit that changed the guarded surface and is stated in the report.
- [ ] A batching-guard candidate replayed over recorded batches finds the 2026-11-05 occurrence.

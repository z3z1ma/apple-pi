# 02: Replay a candidate rule over recorded actions

**What to build:** Given a candidate code rule (GritQL with its paths) or action rule (a command pattern), evaluate it against every recorded `edit`/`write` payload or `bash` command in a window of session logs, and report the actions it would have refused, each linked to its transcript entry, plus the actions it could not evaluate. Built as the native tool `replay_rule` (repo-rules component). A harness guard is code, so its replay is part of its candidate (ticket 03).

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Replaying an existing rule (`github-writes`, since 2026-11-04) lists the recorded command it would have refused, with its entry reference: the refused `gh pr comment` of 2026-11-05 (1,414 commands, four sessions, 1.4 s).
- [x] Replay records no firings: it calls `runRules` and the pattern directly, not the refusal functions.
- [x] Edits are evaluated on the text they added; text the engine cannot evaluate is listed as not evaluated, not counted as a pass.
- [x] The window is given explicitly (a date or a revision) and stated in the report; the steward picks it as the last change to the guarded surface.

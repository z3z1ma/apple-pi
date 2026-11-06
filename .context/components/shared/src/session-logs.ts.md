## file

Reads Pi session JSONL under the sessions directory as a stream: only files modified since the window start, only sessions whose header `cwd` is the given root or below it, and only lines the caller's cheap text test accepts are parsed. Entries before `since` are skipped by their own timestamp.
Why: transcripts reach hundreds of megabytes (reading one as a single string failed with "Invalid string length" at 390 MB), and most lines are irrelevant to any one question.

The root and each session's `cwd` are compared as canonical paths (the nearest existing ancestor's real path), so a session started through a symlink or `/var` versus `/private/var` still belongs to the repository. An entry older than its session's header timestamp is not yielded: Pi's forks (`createBranchedSession`, `forkFrom`) write a new header at fork time and copy the parent's entries with their original timestamps, so those entries belong to the parent, whose own file reports them under its own cwd; this does not depend on which file is read first, and keeps entries without ids. An entry whose timestamp does not parse is skipped. A file is closed (stream destroyed) when its header is refused, not only when read to the end.
Why: review `review-6d6e30ba` (2026-11-06) found each of these.
Coupled: components/repo-rules/src/replay.ts
Verify: components/repo-rules/tests/replay.test.ts

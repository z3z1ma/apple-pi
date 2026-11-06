## file

Reads Pi session JSONL under the sessions directory as a stream: only files modified since the window start, only sessions whose header `cwd` is the given root or below it, and only lines the caller's cheap text test accepts are parsed. Entries before `since` are skipped by their own timestamp.
Why: transcripts reach hundreds of megabytes (reading one as a single string failed with "Invalid string length" at 390 MB), and most lines are irrelevant to any one question.
Coupled: components/repo-rules/src/replay.ts
Verify: components/repo-rules/tests/replay.test.ts

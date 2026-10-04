Status: complete
Created: 2026-10-03
Updated: 2026-10-04

# Retrospective

## What Mattered

- Spikes before design paid off: V1-V4 took minutes and showed that a fork's own `beforeToolCall` can remap arguments, which removed the spec's global tool wrappers.
- Two independent review lanes (standards, intent) per ticket found a significant defect in almost every ticket: symlink and `..` escapes, an apply race with user edits, scorer leaks through temp files, future commits in evaluation clones, wrong task boundaries in real ledger history.
- Keyed draws (labels, not a shared counter) made replay possible; the Dream-RSI change would not have worked without them.

## Learnings

- Faux test parents live in the OS temp directory, so any "allow temp" rule hides parent-escape bugs; test guards with the parent path explicitly refused.
- Phase separation (no scorer on disk while forks run) is the only hiding that survives a shell; string or path guards do not.
- Ledger bundle lifetimes do not bound a task's commits; cite commits in the bundle when work should be measurable later.
- Evaluation arms need the same framing; a bare goal prompt lets a single trajectory stop early.

- `components/tasks/tests/tasks.test.ts` timing tests (Ctrl+B detach, abort) can fail under full `npm test` load and pass alone; rerun the file, then the suite, before calling it a regression.
- `expect` on a bash call that ends in a pipe (`... | grep`) tests the pipe's exit status, not the command's; predict on the command itself or use `set -o pipefail`.
- `pi_exec` globals keep their first type across programs in a session; give each program's variables distinct names or reset.

## Improvements

- Frame arm A like a branch directive before a larger evaluation; prefer test-level oracle gates over whole e2e files.

## file

Code rules run on the standalone GritQL engine, the `@getgrit/gritql` Node binding (a runtime `dependency`, since Pi installs git packages without dev dependencies). The binding runs in a child process (`grit-runner.mjs`) that takes every job for one check on stdin, prints the matches and exits.
Why: a `filter` callback keeps a native reference that never releases, so the process would never exit and each check would leak; a callback that throws aborts the whole process. Neither may happen inside a Pi session.

The query's `language` line alone selects the parser; the job's path and its extension do not matter, so samples need no file name. Matches are de-duplicated by start position, since one node can match more than once.

A query that does not compile either throws (reported as a rule failure) or silently matches nothing. The second case is caught only by the rule's `fires` sample, which `checks.ts` requires for every rule.
Coupled: components/repo-rules/src/checks.ts, components/repo-rules/src/grit-runner.mjs

`grit.ts` and `policy.ts` import only Node built-ins, so `lint/repo-rules.mjs` can import them with Node's own type stripping.
Coupled: lint/repo-rules.mjs, package.json, .pi/rules/policy.json
Verify: components/repo-rules/tests/repo-rules.test.ts

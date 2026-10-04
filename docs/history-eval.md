# History evaluation

A maintainer tool that measures one agent on closed ledger tasks of a repository. It runs on real models and is never part of `npm test`; its code lives in `components/history-eval/` and is not in the package.

```bash
HISTORY_EVAL_CONFIG=eval.json HISTORY_EVAL_OUT=.ledger/<task-id> npm run eval:history
```

`eval.json`:

```json
{
  "model": "coding",
  "tasks": ["<closed task id>"],
  "oracle": { "timeoutSec": 900 },
  "limits": { "wallClockSec": 1800 },
  "cloneIgnored": ["node_modules"],
  "repo": "../other-repo",
  "overrides": { "<task id>": { "base": "<commit>", "final": "<commit>", "tests": ["path/to/a.test.ts"] } }
}
```

`model` is the model profile the runs use, `limits` the budget of one run (at least one of `wallClockSec` and `outputTokens`), `cloneIgnored` the ignored directories cloned into each clone (relative paths without `..` segments), and `repo` the repository whose ledger history holds the tasks, resolved from the working directory (this checkout when absent). `overrides` is optional. A missing file or key prints what to fix and stops before any model request.

**Task evidence.** A task's commits are the ones its closed bundle cites: every hex word of 7 to 40 characters in any file of `.ledger/history/<id>/` that names exactly one commit. They must form one line of history, or the task is skipped for ambiguous provenance. The base is the parent of the oldest cited commit, the final state the newest, the goal the closed `task.md`, and the oracle tests the test files the cited commits add or change that fail on the base (with their final version copied in) and pass on the final commit. Vitest files run under a harness configuration, so the base's test allowlist cannot hide them; `.test.mjs` files run with Node. `overrides` gives a task's base, final commit, and test files explicitly instead. A task without evidence or oracle tests is listed as skipped with the reason.

**Run.** Each task runs once, in a fresh clone that holds only the history reachable from the base, with no remote: the closed `task.md` is the one prompt, under `limits`. Once the session has shut down (which stops its background commands), the oracle test files are copied in and run. If a link the run left would send an oracle file outside the clone, nothing is written and the run counts as failed with that reason. Sessions read the real credentials, `models.json`, and `model-profiles.json`; settings, the models store, and sessions live in a temporary agent directory, and discovery stays off. Each session loads the extensions an ordinary child session loads, plus tasks.

**Report.** Written to `HISTORY_EVAL_OUT` (a `.md` path, or a directory that receives a timestamped report) and rewritten after each task: per task the base, final commit, cited commits, and oracle tests, then whether the run solved it, its outcome, tokens, cache reads, wall-clock, and price at the model's rates, and the totals.

**Cancellation.** `scripts/eval-run.mjs` runs Vitest in its own process group. The first SIGINT or SIGTERM stops the running task, shuts its session down, removes its clone, and writes the report of what finished; a second signal kills the run without cleanup.

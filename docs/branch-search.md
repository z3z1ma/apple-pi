# Branch search

Branch search is a tool for the main agent, `search_branches`. When several distinct approaches are plausible and a command can measure which result is better, the agent runs the approaches side by side and keeps the one that scores best. The agent writes that measure, the **judge**, as part of the call, often from a measure you suggest ("make it faster; time it with `node bench.mjs`"). There is no slash command.

When the agent calls the tool, the harness:

1. Snapshots the workspace, including uncommitted and untracked files, as a base commit, without touching your index.
2. Asks a fork of the conversation for a list of distinct approaches, best first, and runs the first `attempts` of them.
3. Runs each approach in parallel as a fork of the conversation in its own git worktree. Every fork shares the parent's prompt-cache prefix and sees the goal, its approach, and the gates and judges it will be scored by.
4. Commits each attempt's work and puts its protected paths back to their base content. It then runs one command at a time: each attempt's gates, then the judges on the attempts that passed every gate. A judge with `repeat` runs round-robin across those attempts (run 1 of each, then run 2 of each, ...), so drift of the machine favors none of them.
5. Among the attempts that pass every gate and whose every judge printed a number, ranks by the judges' medians in order and direction, then by smaller diff, then by attempt ID. With `judge.profile` set and two or more such attempts, a model on that profile reads their diffs and judge values and chooses among them.
6. Applies the winner's diff when the workspace still holds the base, otherwise reports a merge command.
7. Returns the report as the tool result.

The extension loads only in the root session. Subagents and `pi_exec` workers do not load it, and `pi_exec` programs cannot call `search_branches`.

## The tool call

Parameters:

- `goal`: the observable result that must hold when the work is done.
- `judges`: at least one `{ command, better, repeat?, timeoutSec? }`. `command` is a shell command, run with `bash -lc` in the attempt's worktree, whose last non-empty stdout line is one finite number: time, memory, size, a complexity score, or any quality number a command can print. `better` is `"lower"` or `"higher"`. The first judge decides; later ones break ties. `repeat` (a positive integer, default 1) runs the judge that many times per attempt and ranks by the median, which suits noisy measures such as time. A run that exits non-zero, prints no number, or outlives `timeoutSec` fails that attempt's judge, and so the attempt.
- `gates` (optional): pass/fail shell commands, such as the test suite. Each is a command string or `{ command, timeoutSec? }`. A gate that exits non-zero or outlives its `timeoutSec` fails. An attempt that fails a gate is not judged and never wins.
- `protect` (optional): repository-relative files or directories that the judges and gates read, such as benchmarks and tests. Before scoring, each attempt's changes there are undone: changed files get their base content back, and added files, ignored ones included, are removed. A cloned ignored directory (`workspace.cloneIgnored`) that overlaps a protected path is cloned again from a copy taken before any attempt started, and counts as changed when the attempt's copy differed. The attempt is scored, and applied if it wins, in that restored state, so a winner's own changes to protected paths are never applied. An attempt whose protected cloned directory now resolves outside its worktree, through a symlink it made, is not scored and fails with the reason; nothing is removed or cloned there. After every gate and judge run, the protected paths are checked against the restored state: the worktree's HEAD, and their tracked content and untracked files as git sees them. An attempt whose scoring changed them, even by committing the change, fails with `scoring changed a protected path`. Ignored files are left out of this check, because scoring commands write caches there (such as `__pycache__`); the restore before scoring still removes ignored files under protected paths. Each path must be relative, have no `..` segment, stay inside the repository, and be neither a symlink nor under one; otherwise the call fails before any work starts, naming the symlink's target to protect instead. Paths are normalized, so `./tests/` and `tests` are the same.

Example:

```json
{
  "goal": "parse() handles the 50 MB fixture in under a second, with the same output",
  "judges": [
    { "command": "node bench/parse.mjs --ms", "better": "lower", "repeat": 5, "timeoutSec": 60 },
    { "command": "wc -c < dist/parser.js", "better": "lower" }
  ],
  "gates": ["npm run lint", { "command": "npm test", "timeoutSec": 600 }],
  "protect": ["bench", "test", "fixtures/50mb.json"]
}
```

Commands run with `CI=1`, each in its own process group, which is killed when it settles or outlives its `timeoutSec`. Without `timeoutSec` a command has no time limit.

- The call blocks until the search ends and returns the report; the conversation gains no other message.
- The search forks the conversation through the assistant message that holds the call: the enumerator and every attempt receive their prompt as the result of that call, so their requests share the main agent's prompt cache. The call must therefore be the only tool call in its message; otherwise it fails with `Call search_branches on its own, …` and starts nothing.
- Progress streams as tool updates, `branching <phase>`: `enumerate`, `run`, `score`, `judge` (the judge model), `apply`.
- Aborting the call (for example with Escape) cancels the search; the call returns once cleanup has finished. Switching sessions, navigating the session tree, shutting down, or reloading also cancels it and waits for cleanup.
- One search runs per session. Inside any fork the tool is refused.
- A missing or invalid configuration fails the call with the list of problems.

If `git apply` fails partway, the search puts back to base only the files that still hold what the patch wrote, and the report names any file someone else changed meanwhile.

## Configuration

The tool fails with the list of missing or invalid keys until every required key is set. The code carries no built-in values.

Files, merged key by key, with project values replacing user values:

- `~/.pi/agent/branch-search.json` (the Pi agent directory; `PI_CODING_AGENT_DIR` moves it).
- `.pi/branch-search.json` in the project, read only when the project is trusted.

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `attempts` | integer ≥ 2 | yes | Approaches the enumerator lists, and the most attempts that run. |
| `limits` | `{ wallClockSec?, outputTokens? }` | yes, at least one field | Limits per attempt. An attempt over a limit stops, and its work is still scored. |
| `workspace.cloneIgnored` | string[] | yes | Ignored directories cloned into each worktree, for example `["node_modules", ".venv"]`: relative paths without `..` segments, normalized (`./node_modules` is `node_modules`). |
| `judge.profile` | [model profile](model-profiles.md) name | no | A model that chooses among the attempts that pass every gate. Without it, no judge-model request is sent and the numbers decide. If its request fails or its reply names no qualifying attempt, the numbers decide and the report says why. |

Example (`branch-search.example.json` in the checkout):

```json
{
  "attempts": 3,
  "limits": { "wallClockSec": 900, "outputTokens": 40000 },
  "workspace": { "cloneIgnored": ["node_modules"] }
}
```

## Outcomes

| Outcome | Meaning |
| --- | --- |
| `applied` | The winner's diff was applied to the workspace. |
| `ready` | A winner exists, but the workspace changed during the search. The report gives a `git diff … \| git apply --3way` command that brings it in. |
| `no winner` | No attempt passed every gate with a number from every judge. |
| `aborted: <reason>` | `no git history`, `enumeration failed` (two unusable approach lists), `cancelled`, or `error` with its message. |

The report's first line is the summary, for example `Branch search bs-20261004-142233-9f1c: applied. 2 of 3 attempts passed every gate and judge.` The rest names the winner and its diff size, the judge model's choice when one was made, and every attempt with how its run ended (`done`, `limit`, or `error`), its failed gates (marked `(timed out)` when a time limit killed them) or judge, its judge values, its diff size, and any protected paths it changed. A judge value is the median, followed by the spread `(min–max)` when the judge ran more than once.

## Workspace and record

Each search keeps its state under `$(git rev-parse --git-common-dir)/apple-pi/branch-search/<search-id>/`. Worktrees live under `wt/` there, each fork's private temporary directory under `tmp/`, and the pre-attempt copies of protected cloned directories under `protected/`; all are removed when the search ends, on success, cancel, or error. What stays:

- `record.json`: goal, judges, gates, protected paths, configuration, base, every attempt with its approach, commit (after the protected paths were restored), how its run ended, the protected files it changed, gate results, every judge run's number and their median, diff size, and token cost, the judge model's choice, the winner, the apply result, the outcome, and the search's total token cost.
- `winner.patch`: the applied diff, when the winner was applied.

A `ready` search keeps one ref, `refs/apple-pi/branch-search/<search-id>/<winner>`, for its merge command; every other search ref is deleted.

Attempts are isolated by convention, not sandboxed: each fork's tools point at its own worktree, its writes outside the worktree are refused, its shell runs with its own `TMPDIR`, and every process it started is killed before scoring (see [Forked continuations](forked-continuations.md#worktree-forks)). A shell command can still reach the parent workspace indirectly.

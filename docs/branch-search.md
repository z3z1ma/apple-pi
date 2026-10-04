# Branch search

A single agent run follows the path its model finds most likely. When that path is wrong, the agent tends to repeat variants of the same mistake. Branch search tries several approaches side by side and keeps the one that passes acceptance checks written before any attempt exists.

When a search runs, the harness:

1. Asks a fork of the conversation to write the acceptance checks (the **scorer**), validates them on the current workspace, optionally tests them against wrong solutions (see [Challenger pass](#challenger-pass)), and freezes them.
2. Asks another fork for a list of distinct approaches. When you give a goal, the enumerator prompt and every attempt's directive state it.
3. Uses its own random draw, not the model's preference, to choose which approaches run.
4. Runs each chosen approach as a fork of the conversation in its own git worktree. Every fork shares the parent's prompt-cache prefix.
5. Scores every attempt with the hidden checks. While no attempt passes, it starts a later generation: continuations of the failed attempts that came closest, and fresh approaches from the first list (see [Later generations](#later-generations)).
6. Ranks the survivors and applies the winner's diff to the workspace.
7. Reports the outcome: one passive message for `/branch-search` and for a passive search, or the tool result for `search_branches`.

A search starts in one of three ways: you run `/branch-search`, the main agent calls `search_branches`, or, with passive activation on, the main agent repeats the same failing command (see [Passive activation](#passive-activation)).

The extension loads only in the root session. Subagents and `pi_exec` workers do not load it, and `pi_exec` programs cannot call `search_branches`.

## Commands

- `/branch-search [goal]` starts a search. `goal` is free text that states the observable result that must hold when the work is done. Without a goal, the scorer author infers it from the conversation.
- `/branch-search status` prints the search ID, phase, branch counts per state (running, stopped, survived, dead), and elapsed time.
- `/branch-search cancel` cancels the search. The search ends `aborted: cancelled` and cleans up.
- `/branch-search replay <grid.json>` replays a grid of tree shapes over this repository's stored searches and prints the tuning table (see [Replay tuning](#replay-tuning)). It starts no search and changes no setting.

Only one search runs per session. Starting another while one runs prints the active search ID and starts nothing.

The search forks the conversation as it stands when the search starts. If the main agent is running when you issue the command, the status line shows `branch search queued`, and the search starts when that run settles.

While the search runs, the status line shows `branching <phase> <alive>/<total>`. Phases: `author`, `validate`, `challenge`, `review`, `enumerate`, `run g<n>`, `score g<n>`, `enumerate g<n>` (approach lists for the failed attempts generation `n` continues), `apply`.

Before it applies a winner, the search waits until the main agent is not running. From then until apply, and any rollback, has finished, the main agent's `write`, `edit`, `bash`, and `pi_exec` calls fail with `Branch search is applying its winner to the workspace. Retry this call in a moment.` So do `agent`, `steer_subagent`, `schedule`, and `monitor`, which would start or steer a writer this check cannot see. A subagent or managed task that was already running keeps running and is not held. Cancel works during the wait.

If `git apply` fails partway, the search puts back to base only the files that still hold what the patch wrote. A file someone else changed in the meantime, for example in an editor, is left alone, and the report names it.

Switching sessions, navigating the session tree, shutting down, or reloading cancels the search and waits until cleanup has finished: worktrees removed, refs pruned, and the record final. No report is added, except after a reload, which keeps the session: there the `aborted: cancelled` report joins it as usual.

## The `search_branches` tool

The main agent can start a search itself with `search_branches`. Its one parameter, `goal`, states the observable result that must hold when the work is done. The tool's prompt guidance tells the model to reach for it when two or more approaches are plausible and it cannot tell which is right, or after an approach has failed.

- The call blocks until the search ends and returns the report as its result. The conversation gains nothing else: no passive message.
- The search forks the conversation through the assistant message that holds the call. The scorer author, the first approach list, and every fresh attempt receive their prompt as the result of that call, so their requests start with the main agent's own request and share its prompt cache. The first fork request writes that assistant message to the cache. Continuations of a failed attempt continue that attempt's conversation, as with the command.
- The call must be the only tool call in its message. Otherwise it fails with `Call search_branches on its own, as the only tool call in its message, …` and starts nothing.
- Progress streams as tool updates in the status format, `branching <phase> <alive>/<total>`. The status line is not used.
- While the search applies its winner, the main agent is still blocked in the call, so the search does not wait for it to settle. The same root tools as for the command are refused during the apply.
- Aborting the call (for example with Escape) cancels the search; the call returns once cleanup has finished, with the `aborted: cancelled` report.
- While another search runs, from the command or the tool, the call fails at once with `Branch search <id> is already running.` `/branch-search status` and `/branch-search cancel` work on a search the tool started.
- Inside a fork the tool is refused: search forks get `This tool is not available inside a branch search attempt.`, other forked continuations get `search_branches is not available inside a forked continuation.`
- A missing or invalid configuration fails the call with the list of problems.

## Passive activation

With `passive.enabled` set to `true`, a search starts on its own when the main agent is stuck on one failure.

The harness watches the results of the main agent's shell commands: `bash`, and any tool whose result reports an exit code. Commands that forks run (branch search attempts, reflections) do not count. The exit code comes from the tool's structured exit status when it reports one; otherwise a failed command is an error result that ends with `Command exited with code <n>`, and any other successful result counts as exit 0. Output that merely contains that line, and a command started in the background or moved there with Ctrl+B, are not exits. For each command that exits non-zero, it computes a failure signature from:

- the command, with runs of whitespace collapsed to one space;
- the exit code;
- the first output line that matches `error`, `fail`, `exception`, `panic`, or `assert` (any case), or else the last non-empty line, with each absolute path replaced by its file name and each run of digits, or of six or more hex characters (also inside a longer word), replaced by `#`.

So the same test failing at a different line number, in a different temporary directory, or with a different commit hash in its message, counts as the same failure. When the same command later exits 0, the harness forgets every failure of that command.

When the main agent's run settles, no search is running, and one failure has repeated `passive.repeatThreshold` times, a passive search starts with that command as its **seed gate**: the scorer author is told that the command failed repeatedly and to use it as a gate that fails on the current workspace if it expresses the goal, and the scorer review sees it too. The search has no stated goal, so the author infers it from the conversation. It forks the conversation as it stands at that settle, and it reports, like `/branch-search`, with one passive message that starts no turn. The record stores `mode: "passive"` and the `seedGate`. The harness shows the notice ``Branch search started: `<command>` failed <n> times.``, and `/branch-search status` and `/branch-search cancel` work on the passive search.

Every search that starts in the main session, whether from `/branch-search`, `search_branches`, or passive activation, and however it ends (cancelled included), spends each failure that has reached `passive.repeatThreshold` at that moment: none of them starts a passive search later in the session, however often it repeats. A `/branch-search` you queued still starts as usual. The search's report message, or its `search_branches` result, lists the spent signatures in its details. When a session starts, the harness reads them back from those reports and rebuilds the counts from the main agent's tool results on the current branch, so resuming or reloading a session keeps both. A search cut off by a reload still adds its report, so its signatures stay spent. A `/branch-search` or passive search cut off by a session switch, tree navigation, or shutdown adds no report, so the signatures it spent are not kept when you come back to that session. A new session starts with no counts and nothing spent. With `passive.enabled` set to `false`, no repeat count starts a search.

The same detector runs inside each attempt, with that attempt's own counts and regardless of `passive.enabled`. When one failure repeats `passive.repeatThreshold` times in an attempt, the harness stops the attempt, which reports `stalled`. Its work is still committed and scored, like an attempt stopped by a limit.

## Configuration

The feature stays off until every required key is set. `/branch-search` then prints each missing or invalid key, `search_branches` returns them as an error, and neither starts anything. The code carries no built-in values for limits or counts.

Files, merged key by key, with project values replacing user values and arrays replacing whole:

- `~/.pi/agent/branch-search.json` (the Pi agent directory; `PI_CODING_AGENT_DIR` moves it).
- `.pi/branch-search.json` in the project, read only when the project is trusted.

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `passive.enabled` | boolean | yes | Starts a search when the main agent repeats one failure (see [Passive activation](#passive-activation)). |
| `passive.repeatThreshold` | integer ≥ 2 | yes | Repeats of one failure that start a passive search, and that stop an attempt as `stalled`. |
| `enumerate.count` | integer ≥ 2 | yes | Approaches requested from the enumerator. |
| `branches.perGeneration` | integer ≥ 1 | yes | Approaches that run in the first generation. |
| `branches.maxTotal` | integer ≥ 1 | yes | Upper bound on attempts in one search, over all generations. |
| `generations.maxDepth` | integer ≥ 0 | yes | Generations after the first. `0` ends the search after the first generation. |
| `generations.rootsPerGeneration` | integer ≥ 0 | yes | Approaches from the first list, not yet run, that each later generation starts fresh. |
| `generations.parentsPerGeneration` | integer ≥ 1 | yes | Failed attempts of the previous generation that each later generation continues. |
| `generations.childrenPerParent` | integer ≥ 1 | yes | Continuations of each of those failed attempts. |
| `branch.limits` | `{ wallClockSec?, outputTokens? }` | yes, at least one field | Limits per attempt. An attempt over a limit stops, and its work is still scored. |
| `scorer.validationRetries` | integer ≥ 0 | yes | Corrections the author may make to checks that fail validation. |
| `scorer.challengers` | integer ≥ 1 | no | Challenger forks that each write a wrong solution to test the authored checks (see [Challenger pass](#challenger-pass)). Without it, no challenger runs. |
| `scorer.reviewProfile` | model profile name | no | A [model profile](model-profiles.md) that reviews the checks once. |
| `fidelity.profile` | model profile name | no | Evaluation only: after each generation, one request per attempt on this profile asks whether the attempt's diff follows its approach, and the record keeps the answer, its reason, and its token cost. The tag never decides which attempt wins. |
| `constraints` | string[] | yes | Extra constraints the draw may add to an approach. The harness adds `none`. |
| `workspace.cloneIgnored` | string[] | yes | Ignored directories cloned into each worktree, for example `["node_modules", ".venv"]`. |
| `apply` | `"auto"` or `"report"` | yes | `auto` applies the winner when the workspace did not change during the search. |
| `draw` | `"random"` or `"model"` | no | How approaches are chosen. Defaults to `"random"`. `"model"` runs each list's preferred approach first, then the others in listed order; it exists to measure the random draw against the model's own choice. |

Example:

```json
{
  "passive": { "enabled": false, "repeatThreshold": 3 },
  "enumerate": { "count": 4 },
  "branches": { "perGeneration": 3, "maxTotal": 6 },
  "generations": { "maxDepth": 1, "rootsPerGeneration": 1, "parentsPerGeneration": 1, "childrenPerParent": 2 },
  "branch": { "limits": { "wallClockSec": 900 } },
  "scorer": { "validationRetries": 2, "challengers": 2 },
  "constraints": ["Add no new dependencies.", "Change as few files as possible."],
  "workspace": { "cloneIgnored": ["node_modules"] },
  "apply": "auto"
}
```

## The scorer

The scorer author is a fork of the conversation in its own worktree. It writes **gates** (shell commands that must exit 0), optional **objectives** (commands that print one number, used to rank attempts that pass every gate), test files the harness installs before scoring, and files it restores to their current content before scoring.

The harness validates the scorer on the current workspace: every gate runs twice and must give the same result as declared, and every objective must print a number. A scorer that fails validation goes back to the author with the report, up to `scorer.validationRetries` times. If it still fails, the search ends `aborted: scorer invalid`.

With `scorer.challengers` set, the challenger pass follows (see [Challenger pass](#challenger-pass)).

With `scorer.reviewProfile` set, one request on that profile reviews the checks: the goal, the files changed since `HEAD`, and the scorer. A `refine` verdict replaces the scorer once, if the replacement validates (which includes rejecting every gap the challenger pass found). If the review request fails or the replacement does not validate, the author's scorer stands and the record says why. Without a review profile, no review request is sent.

The harness then freezes the scorer: it records the SHA-256 of the scorer's exact bytes before any approach is listed or run, and at the end stores those bytes as `spec.json`. A search never changes its scorer.

## Challenger pass

Authored checks can miss a plausible mistake, so with `scorer.challengers` set the search attacks them before any approach is listed. It applies only to an authored scorer; a supplied scorer (evaluation with oracle gates) skips it.

1. That many challengers start at once. Each is a fork of the conversation at the fork point, with the same blocked tools, private temporary directory, and `branch.limits` as an attempt. Its prompt asks for a plausible but wrong implementation of the goal, the kind of fix a capable engineer might ship, and a final line `defect: <the defect it planted>`. Challengers never see the checks.
2. Each challenger works in its own worktree of the base. The harness commits its work into the scorer's private object store (see [Keeping the scorer hidden](#keeping-the-scorer-hidden)) and removes the worktree.
3. It runs the authored gates on each solution, in a fresh worktree of its commit with the scorer's files installed and its protected paths restored. Gate commands there run with the private store's git environment, so they see the solution's commit. A solution that passes every gate is a **gap**.
4. When there are gaps, the author's conversation continues with each gap's diff and stated defect. A claimed defect is not proof, so the author judges each gap: it revises the spec so its gates reject the solution, or, when the solution actually meets the goal, it dismisses the claim with a one-line reason (`{"dismissed": {"challenger-1": "<reason>"}, "spec": …}`, with `spec` omitted when it dismisses every gap). A dismissed gap no longer counts: it causes no abort, and the gates need not reject it. Validation now also requires that the gates reject every gap that is not dismissed. A failed revision goes back to the author with the report, like any validation failure. These repair turns share the bound `scorer.validationRetries`. If it runs out (at once when it is `0`) with a gap neither rejected nor dismissed, the scorer is invalid: the search ends `aborted: scorer invalid`, the last validation report names the open gaps, and no review request is sent.
5. After the review, every challenger solution runs against the final scorer. A solution it rejects is **caught**. If it accepts any that is not dismissed, for example because a revision closed one gap but weakened a check another challenger's defect relied on, the search ends `aborted: scorer invalid` with that solution named in the report.
6. The private object store, and with it every challenger solution, is deleted before the enumerator starts.

Each challenger costs its tokens in the search's cost, including a challenger that was cancelled or failed. Challengers are not rerun after a repair.

## Later generations

When every attempt of a generation fails a gate, and fewer than `generations.maxDepth` generations have followed the first, the search plans another generation:

1. It ranks that generation's failed attempts by gates passed (more first), then by diff size (smaller first), then by attempt ID, and takes the first `generations.parentsPerGeneration`.
2. For each of them, an enumerator forks that attempt's final conversation, in a new worktree of its committed state, and lists approaches from there. It knows what the attempt tried, so its list reflects what the attempt learned. These enumerators run at once. If one of them gives two unusable lists, the others stop and the search ends `aborted: enumeration failed`.
3. The generation runs the next `generations.rootsPerGeneration` approaches of the first list that have not run, as fresh attempts from the starting workspace, and then the first `generations.childrenPerParent` approaches of each failed attempt's list, in rank order. Each continuation forks its failed attempt's final conversation, works in a new worktree of that attempt's committed state, and is told only that hidden checks rejected the state, never which check failed or what it printed. Paths of the failed attempt's worktree (or of its own predecessors) that appear in that conversation point at the continuation's worktree.
4. The search never runs more than `branches.maxTotal` attempts. It drops the attempts that would exceed the bound from the end of the generation. A generation with nothing left to run ends the search `no survivor`, as does a failed generation at `generations.maxDepth`.

Attempt IDs record where an attempt came from: `r2` runs position 2 of the first list's drawn order, and `r2.c0` runs position 0 of `r2`'s own list. Each list's drawn order, and each attempt's constraint, is drawn from the search's seed and the ID alone, so an attempt gets the same approach and constraint however the counts are configured. A continuation shares its failed attempt's prompt cache. The worktrees of a scored generation, which hold the installed checks, are removed before any fork of the next step starts.

## Replay tuning

Every finished search leaves a record of each attempt it ran: its outcome and its cost. Because an attempt's approach and constraint depend only on the seed and its ID, a different tree shape run on the same search would have run some of the same attempts, with the same outcomes. Replay uses this to compare tree shapes on past searches without running a model or a check again. It calls the same planning and selection code as a live search, so replaying a search's own configuration reproduces its steps, its winner, and its outcome.

Only the tree-shape keys can be tuned this way: `branches.perGeneration`, `branches.maxTotal`, `generations.maxDepth`, `generations.rootsPerGeneration`, `generations.parentsPerGeneration`, and `generations.childrenPerParent`. The other keys change what the model or the checks produce.

To tune:

1. Collect searches. Replay uses every search in the repository that ended `applied`, `ready`, or `no survivor` (a **world**); aborted and unfinished searches are skipped. Replay reads each world's `record.json` and the frozen `spec.json` beside it, whose gates and objective directions select the winner. A record that is not valid JSON, is not a search record, lacks what replay reads (for example an empty approach list), or whose `spec.json` is missing or does not match the hash in the record, is listed as `Unreadable:` with its path; the others are still replayed.
2. Write a grid file that maps tunable keys to lists of values, for example:

   ```json
   { "branches.perGeneration": [2, 3], "generations.childrenPerParent": [1, 2] }
   ```

   The grid is every combination of the listed values, with each unlisted key at its current value. The current configuration is always in the grid. An unknown key, a value list that is empty, or a value the configuration would reject prints the problem, and nothing is replayed.
3. Run `/branch-search replay grid.json`. A relative path is resolved from the session's working directory. The command reads every record under `$(git rev-parse --git-common-dir)/apple-pi/branch-search/`.
4. Set the winning values in `branch-search.json` yourself; the command changes no setting.

Each world is replayed under its own seed, its own approach lists, and its own `draw` mode: a search that ran with `draw: "model"` replays only under `draw: "model"`, and the grid cannot set `draw`. A configuration is **unevaluable** on a world when it asks for an attempt or a failed attempt's approach list that the world never produced.

The table:

```
Replay tuning over 5 records, 4 worlds.
Current: branches.perGeneration=3 branches.maxTotal=6 generations.maxDepth=1 …
Compared on 3 worlds where every configuration is evaluable.
Rank  Solved  Tokens  Wall-clock  Configuration
1     2/3     84120   312.4s      branches.perGeneration=2
2     2/3     97311   340.0s      current
3     2/3     97311   340.0s      generations.childrenPerParent=3
Unevaluable:
  generations.childrenPerParent=3: bs-20261004-142233-9f1c (no node r1.c2)
```

- A configuration is named by the keys it changes from the current one.
- Configurations are compared only on the worlds where every configuration is evaluable. **Solved** counts those worlds on which the configuration's replay ends with a winner. **Tokens** adds, per world, the scorer author's and the scorer review's tokens, the approach lists the configuration used (the first list included), and the attempts it ran; input, cache-read, cache-write, and output tokens all count. **Wall-clock** adds, per generation, the longest attempt's run plus scoring time; it leaves out the scorer author, validation, review, and approach listing.
- Rank orders by solved (more first), then tokens, then wall-clock (lower first). The current configuration wins a tie, so tuning never moves to a configuration that only replays as well.
- **Unevaluable** lists, per configuration, the worlds it could not replay and the first missing attempt or list.

Limits:

- Replay sees only the attempts that ran. A configuration larger than the recorded searches is unevaluable on them, so tuning can shrink a configuration, and can grow it only after searches that ran with larger values.
- Each attempt's outcome is one sample from a model that might do otherwise on another run. Replay treats it as the outcome.

## Evaluation

The maintainer evaluation measures search against a single trajectory on this repository's closed ledger tasks. It runs on real models and is never part of `npm test`:

```bash
BRANCH_SEARCH_EVAL_CONFIG=eval.json BRANCH_SEARCH_EVAL_OUT=.ledger/<task-id> npm run eval:branch-search
```

`eval.json` names the model profile every arm runs on (`model`), the closed task ids (`tasks`), the time limit of one oracle test run (`oracle.timeoutSec`), optional explicit task boundaries (`overrides`, below), and the search configuration (`search`, every required key of `branch-search.json`). A missing file or key prints what to fix and stops before any model request. SIGINT or SIGTERM to the command stops the running arm, shuts its session down, removes its clone, and writes the report of what finished; a second signal kills the run without cleanup. Both evaluation commands run through `scripts/eval-run.mjs`, which keeps Vitest in its own process group and passes the stop to the evaluation, because Vitest itself exits on either signal before the evaluation could clean up.

**Task evidence.** Tasks interleave in the history, so the span from a bundle's creation to its archiving is not the task's work. A task's commits are the ones its bundle cites: every hex word of 7 to 40 characters in any file of the closed bundle that names exactly one commit of this repository. The cited commits must form one line of history; otherwise the task is skipped for ambiguous provenance. The base is the parent of the oldest cited commit, the final state the newest, and the goal the closed `task.md`. The oracle gates are the test files the cited commits add or change, and only those, that fail on the base with their final version copied in and pass on the final commit; Vitest files run under a harness configuration, so the base's test allowlist cannot hide them. `overrides` sets a task's boundaries explicitly instead: `{"<task id>": {"base": "<commit>", "final": "<commit>", "tests": ["<path>", ...]}}`, where `tests` defaults to the test files changed from base to final. A task without cited commits or an override, or without oracle gates, is listed as skipped with the reason.

**Arms.** Each task runs five times: A, one prompt to the main agent under `branch.limits`; B, a search with `draw: "model"`; C, a search with `draw: "random"`; B and C once with the oracle gates as the scorer (without `scorer.reviewProfile`) and once with an authored scorer. Every final state, the winner's commit for a search, is scored with the oracle gates once the arm's session has shut down, which stops any background command it started.

**Isolation.** Every run happens in a fresh temporary repository that holds only the history reachable from the base, fetched through a temporary ref that is deleted at once, with no remote and with `workspace.cloneIgnored` cloned in; the task's solution and its oracle tests cannot be read through git, and the oracle test files are copied in only for scoring, after the arm ends. The sessions read the real credentials, `models.json`, and `model-profiles.json`; settings, the models store, and sessions live in a temporary agent directory, and extension, package, skill, prompt, and theme discovery stays off. Each session loads the extensions an ordinary child session loads, plus tasks, and excludes the tools a search fork may not run.

**Report.** Written to `BRANCH_SEARCH_EVAL_OUT` (a `.md` path, or a directory such as the active ledger task bundle), it lists per task the base, final commit, and cited commits, and per arm whether it solved the task, its tokens, cache reads, run wall-clock, and main-model-equivalent price, C's winner rank, tail wins, and the success criteria. The winner rank is the position of the winner's root ancestor in the model order of the root enumeration (`preferred` first, then the returned order). A tail win is conservative: arm C solved the task, and that root is not `preferred` and sits at or beyond the most roots B's configuration could ever draw (`branches.perGeneration + generations.maxDepth × generations.rootsPerGeneration`, at most `branches.maxTotal`). Each search's `record.json` and `spec.json` are copied beside the report.

### Trap benchmark

The trap benchmark measures, on staged puzzles, whether search with challengers beats one trajectory. Each trap under `components/branch-search/eval/traps/` is a tiny repository (`repo/`), a goal (`goal.md`), a hidden oracle (`oracle.test.mjs`, run with `TRAP_DIR` set to the repository to judge), the obvious fix that passes the visible tests and fails the oracle (`wrong/`), and a correct fix (`right/`). It runs on real models and is never part of `npm test`:

```bash
BRANCH_SEARCH_TRAPS_CONFIG=traps.json BRANCH_SEARCH_TRAPS_OUT=.ledger/<task-id> npm run eval:traps
```

`traps.json` names the model profile every arm runs on (`model`), the traps (`traps`, directory names), the runs per arm (`runsPerArm`), how many runs execute at once (`concurrency`), the time limit of one oracle run (`oracle.timeoutSec`), and the search configuration (`search`: every required key of `branch-search.json`, plus `scorer.challengers`, which only the challengers arm uses). `components/branch-search/eval/traps.example.json` is a complete example. A missing file or key prints what to fix and stops before any session opens.

**Arms.** `alone` is one prompt: the goal with the commitment framing of an attempt directive, under `branch.limits`. `search` runs a search with an authored scorer and no challengers; `search+challengers` runs one with `scorer.challengers`. Each run copies the trap's `repo/` into a fresh temporary directory, commits it as the only commit, runs the arm there, scores the final state with the oracle once the session has shut down, and removes the directory. A search's final state is its winner's commit, applied or not, else the base.

**Scorer kill rate.** After each search, the trap's `wrong/` solution is put on a fresh copy of the base, the search's frozen scorer files are installed and its protected paths restored, and its gates run: the solution is killed when any gate fails. A search that froze no scorer counts as no kill.

**Report.** Written to `BRANCH_SEARCH_TRAPS_OUT` (a `.md` path, or a directory), and rewritten after each run, it lists per trap and arm the solve rate, median run wall-clock, total tokens, and main-model-equivalent price, the scorer kill rate per search arm, the overall solve rate per arm, every run, and the win-bar verdict: met when search with challengers solves at least 20 percentage points more runs than the agent alone, over all traps. Each search's `record.json` and `spec.json` are copied beside the report. SIGINT or SIGTERM to the command starts no further run, stops the running arms, removes their directories, and writes the report of the runs that finished; a second signal kills the run without cleanup.

## Keeping the scorer hidden

Attempts cannot see the checks that judge them. The harness keeps them apart in time rather than by guarding paths, because a shell can reach any path indirectly:

- While any enumerator or attempt runs, no scorer file exists on disk, no scorer command runs, and the scorer is in no prompt. The scorer lives only in the harness's memory.
- The author writes the scorer only in its reply. Its worktree and the validation worktree are removed before the enumerator starts.
- The author and the challengers run their shell commands with `GIT_OBJECT_DIRECTORY` pointing at a private object store under the search's state directory, with the repository's store as an alternate. A `git add`, `git commit`, or `git stash` they run, and the harness's commits of the challengers' work, write there, never into the repository's object store. The store is deleted before the enumerator starts, so no attempt can find scorer or challenger content among the repository's unreachable objects. Refs are shared, though: a branch, tag, commit on a branch, or stash that these forks create would name objects in the private store. So the harness reads every ref (`refs/stash` included) before the author starts, and before the store is deleted it undoes the forks' ref changes. A ref created or moved meanwhile counts as the forks' change only when the repository's own object store lacks its new value, because the forks write objects only to the private store. Such a ref is deleted if it is new. If it moved, its newest reflog entries are dropped while only the private store holds their object (a challenger's stash entry, say), and an entry the repository's store holds is never dropped; the ref ends at the newest remaining entry, or at its old value. A change whose value the repository's store holds, such as a commit, branch, or stash you make in your checkout while the scorer is written, is yours: that ref and its reflog stay exactly as they are. So if you stash on top of a challenger's stash, the challenger's entry stays in the stash reflog below yours, naming an object that is gone once the store is deleted. A fork that points a ref at an object already in the repository's store, for example `git branch -f x HEAD~1`, is mistaken for yours and keeps that ref. Refs deleted meanwhile are recreated. The search's own refs are left alone. If restoring fails, the search ends `aborted: error`, cleanup tries once more, and if that fails too it keeps the store, so no ref names a missing object, and lists the failure under `cleanupErrors`.
- Challenger solutions are scorer content too: their diffs and stated defects reach only the author, and join the record when the search ends.
- Every fork (author, enumerator, attempt) gets a private temporary directory under the search's state directory, outside every worktree. Its shell commands run with `TMPDIR`, `TMP`, and `TEMP` pointing there, long command output spills there, and its `write` and `edit` calls may write only there and in its worktree. The directory is deleted when the fork stops, so nothing the author put in temporary files reaches a later attempt.
- Every shell command an attempt starts runs in its own process group. When the attempt stops, the harness kills every group that still has a process, and waits until they are gone, before any scoring starts. A process left running cannot watch the checks.
- Scoring installs the scorer's files in each attempt's worktree only after the attempt's work is committed, so the winning diff never contains them.
- `spec.json` and the scoring results join the record only after the last attempt has stopped.

If a process survives the kill, the search ends `aborted: error` instead of scoring.

Residual risks, accepted in this version:

- A process that leaves its process group (for example with `setsid` or a double fork into a new session) escapes the kill and could watch scoring.
- A scorer-side fork's shell command that unsets `GIT_OBJECT_DIRECTORY` or names the repository's git directory explicitly can still write to the shared object store.
- A shell command can still write to a temporary path it names literally, such as `/tmp/x`, instead of `$TMPDIR`; that file is not deleted with the fork.
- Process groups are tracked by number. A group that empties while its attempt keeps running is forgotten when the attempt next starts a command, but until then its number could be reused by an unrelated group, which the kill would then reach.

## Outcomes

| Outcome | Meaning |
| --- | --- |
| `applied` | The winner's diff was applied to the workspace. |
| `ready` | A winner exists, but the workspace changed during the search or `apply` is `report`. The report gives a `git diff … \| git apply --3way` command that brings the winner in. |
| `no survivor` | No attempt passed every gate. |
| `aborted: <reason>` | The search stopped early: `no git history`, `scorer invalid`, `enumeration failed`, `cancelled`, or `error`. |

Each attempt in the report carries its self-report: `done` or `abandoned` from its final message, `unknown` when that message says neither, `limit` when it exceeded `branch.limits`, `stalled` when it repeated one failure up to `passive.repeatThreshold`, or `error` when its run ended on a provider error. The self-report never decides an attempt's fate; the checks do.

The report's first line is the summary, for example `Branch search bs-20261004-142233-9f1c: applied. 1 of 3 branches survived over 1 generations.` The rest gives the winner, its objective values, every attempt with its fate and one-sentence lesson, and the record path. From `/branch-search` and a passive search, the chat shows the summary line and expanding the message shows the rest; the message starts no turn. From `search_branches`, the whole report is the tool result.

## Workspace and record

Each search keeps its state under `$(git rev-parse --git-common-dir)/apple-pi/branch-search/<search-id>/`. The search snapshots the workspace, including uncommitted and untracked files, as a base commit without touching your index. Worktrees live under `wt/` there and are removed when the search ends, on success, cancel, or error.

After the search, the directory keeps:

- `record.json`: mode, goal, seed gate, seed, configuration, base, the scorer's hash, validation reports and review, the token cost of the scorer author, of the review, and of the challengers, each challenger's diff, stated defect, whether it was a gap, whether the author dismissed it and why, and whether the frozen gates reject it (with `scorer.challengers`), every approach list with the attempt it continues and its cost, every planning step, every attempt with its parent, generation, start and end order, approach, constraint, commits, self-report, gate and objective results, fidelity tag (with `fidelity.profile`), and token cost, plus the winner and outcome.
- `spec.json`: the frozen scorer; its SHA-256 equals the hash in the record.
- `winner.patch`: the applied diff, when the winner was applied.

Replay tuning reads only `record.json` and `spec.json`.

Refs under `refs/apple-pi/branch-search/<search-id>/` keep the base and the winner; the other attempt refs are deleted.

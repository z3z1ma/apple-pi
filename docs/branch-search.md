# Branch search

A single agent run follows the path its model finds most likely. When that path is wrong, the agent tends to repeat variants of the same mistake. Branch search tries several approaches side by side and keeps the one that passes acceptance checks written before any attempt exists.

When a search runs, the harness:

1. Asks a fork of the conversation to write the acceptance checks (the **scorer**), validates them on the current workspace, and freezes them.
2. Asks another fork for a list of distinct approaches. When you give a goal, the enumerator prompt and every attempt's directive state it.
3. Uses its own random draw, not the model's preference, to choose which approaches run.
4. Runs each chosen approach as a fork of the conversation in its own git worktree. Every fork shares the parent's prompt-cache prefix.
5. Scores every attempt with the hidden checks. While no attempt passes, it starts a later generation: continuations of the failed attempts that came closest, and fresh approaches from the first list (see [Later generations](#later-generations)).
6. Ranks the survivors and applies the winner's diff to the workspace.
7. Adds one passive message with the report to the conversation.

The extension loads only in the root session. Subagents and `pi_exec` workers do not load it.

## Commands

- `/branch-search [goal]` starts a search. `goal` is free text that states the observable result that must hold when the work is done. Without a goal, the scorer author infers it from the conversation.
- `/branch-search status` prints the search ID, phase, branch counts per state (running, stopped, survived, dead), and elapsed time.
- `/branch-search cancel` cancels the search. The search ends `aborted: cancelled` and cleans up.

Only one search runs per session. Starting another while one runs prints the active search ID and starts nothing.

The search forks the conversation as it stands when the search starts. If the main agent is running when you issue the command, the status line shows `branch search queued`, and the search starts when that run settles.

While the search runs, the status line shows `branching <phase> <alive>/<total>`. Phases: `author`, `validate`, `review`, `enumerate`, `run g<n>`, `score g<n>`, `enumerate g<n>` (approach lists for the failed attempts generation `n` continues), `apply`.

Before it applies a winner, the search waits until the main agent is not running. From then until apply, and any rollback, has finished, the main agent's `write`, `edit`, `bash`, and `pi_exec` calls fail with `Branch search is applying its winner to the workspace. Retry this call in a moment.` So do `agent`, `steer_subagent`, `schedule`, and `monitor`, which would start or steer a writer this check cannot see. A subagent or managed task that was already running keeps running and is not held. Cancel works during the wait.

If `git apply` fails partway, the search puts back to base only the files that still hold what the patch wrote. A file someone else changed in the meantime, for example in an editor, is left alone, and the report names it.

Switching sessions, navigating the session tree, or shutting down cancels the search and waits until cleanup has finished: worktrees removed, refs pruned, and the record final. No report is added.

## Configuration

The feature stays off until every required key is set. `/branch-search` then prints each missing or invalid key and starts nothing. The code carries no built-in values for limits or counts.

Files, merged key by key, with project values replacing user values and arrays replacing whole:

- `~/.pi/agent/branch-search.json` (the Pi agent directory; `PI_CODING_AGENT_DIR` moves it).
- `.pi/branch-search.json` in the project, read only when the project is trusted.

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `passive.enabled` | boolean | yes | Enables passive activation after repeated failures (not available yet). |
| `passive.repeatThreshold` | integer ≥ 2 | yes | Repeats of one failure that trigger passive search. |
| `enumerate.count` | integer ≥ 2 | yes | Approaches requested from the enumerator. |
| `branches.perGeneration` | integer ≥ 1 | yes | Approaches that run in the first generation. |
| `branches.maxTotal` | integer ≥ 1 | yes | Upper bound on attempts in one search, over all generations. |
| `generations.maxDepth` | integer ≥ 0 | yes | Generations after the first. `0` ends the search after the first generation. |
| `generations.rootsPerGeneration` | integer ≥ 0 | yes | Approaches from the first list, not yet run, that each later generation starts fresh. |
| `generations.parentsPerGeneration` | integer ≥ 1 | yes | Failed attempts of the previous generation that each later generation continues. |
| `generations.childrenPerParent` | integer ≥ 1 | yes | Continuations of each of those failed attempts. |
| `branch.limits` | `{ wallClockSec?, outputTokens? }` | yes, at least one field | Limits per attempt. An attempt over a limit stops, and its work is still scored. |
| `scorer.validationRetries` | integer ≥ 0 | yes | Corrections the author may make to checks that fail validation. |
| `scorer.reviewProfile` | model profile name | no | A [model profile](model-profiles.md) that reviews the checks once. |
| `fidelity.profile` | model profile name | no | Reserved for evaluation. |
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
  "scorer": { "validationRetries": 2 },
  "constraints": ["Add no new dependencies.", "Change as few files as possible."],
  "workspace": { "cloneIgnored": ["node_modules"] },
  "apply": "auto"
}
```

## The scorer

The scorer author is a fork of the conversation in its own worktree. It writes **gates** (shell commands that must exit 0), optional **objectives** (commands that print one number, used to rank attempts that pass every gate), test files the harness installs before scoring, and files it restores to their current content before scoring.

The harness validates the scorer on the current workspace: every gate runs twice and must give the same result as declared, and every objective must print a number. A scorer that fails validation goes back to the author with the report, up to `scorer.validationRetries` times. If it still fails, the search ends `aborted: scorer invalid`.

With `scorer.reviewProfile` set, one request on that profile reviews the checks: the goal, the files changed since `HEAD`, and the scorer. A `refine` verdict replaces the scorer once, if the replacement validates. If the review request fails or the replacement does not validate, the author's scorer stands and the record says why. Without a review profile, no review request is sent.

The harness then freezes the scorer: it records the SHA-256 of the scorer's exact bytes before any approach is listed or run, and at the end stores those bytes as `spec.json`. A search never changes its scorer.

## Later generations

When every attempt of a generation fails a gate, and fewer than `generations.maxDepth` generations have followed the first, the search plans another generation:

1. It ranks that generation's failed attempts by gates passed (more first), then by diff size (smaller first), then by attempt ID, and takes the first `generations.parentsPerGeneration`.
2. For each of them, an enumerator forks that attempt's final conversation, in a new worktree of its committed state, and lists approaches from there. It knows what the attempt tried, so its list reflects what the attempt learned. These enumerators run at once. If one of them gives two unusable lists, the others stop and the search ends `aborted: enumeration failed`.
3. The generation runs the next `generations.rootsPerGeneration` approaches of the first list that have not run, as fresh attempts from the starting workspace, and then the first `generations.childrenPerParent` approaches of each failed attempt's list, in rank order. Each continuation forks its failed attempt's final conversation, works in a new worktree of that attempt's committed state, and is told only that hidden checks rejected the state, never which check failed or what it printed. Paths of the failed attempt's worktree (or of its own predecessors) that appear in that conversation point at the continuation's worktree.
4. The search never runs more than `branches.maxTotal` attempts. It drops the attempts that would exceed the bound from the end of the generation. A generation with nothing left to run ends the search `no survivor`, as does a failed generation at `generations.maxDepth`.

Attempt IDs record where an attempt came from: `r2` runs position 2 of the first list's drawn order, and `r2.c0` runs position 0 of `r2`'s own list. Each list's drawn order, and each attempt's constraint, is drawn from the search's seed and the ID alone, so an attempt gets the same approach and constraint however the counts are configured. A continuation shares its failed attempt's prompt cache. The worktrees of a scored generation, which hold the installed checks, are removed before any fork of the next step starts.

## Keeping the scorer hidden

Attempts cannot see the checks that judge them. The harness keeps them apart in time rather than by guarding paths, because a shell can reach any path indirectly:

- While any enumerator or attempt runs, no scorer file exists on disk, no scorer command runs, and the scorer is in no prompt. The scorer lives only in the harness's memory.
- The author writes the scorer only in its reply. Its worktree and the validation worktree are removed before the enumerator starts.
- Every fork (author, enumerator, attempt) gets a private temporary directory under the search's state directory, outside every worktree. Its shell commands run with `TMPDIR`, `TMP`, and `TEMP` pointing there, long command output spills there, and its `write` and `edit` calls may write only there and in its worktree. The directory is deleted when the fork stops, so nothing the author put in temporary files reaches a later attempt.
- Every shell command an attempt starts runs in its own process group. When the attempt stops, the harness kills every group that still has a process, and waits until they are gone, before any scoring starts. A process left running cannot watch the checks.
- Scoring installs the scorer's files in each attempt's worktree only after the attempt's work is committed, so the winning diff never contains them.
- `spec.json` and the scoring results join the record only after the last attempt has stopped.

If a process survives the kill, the search ends `aborted: error` instead of scoring.

Residual risks, accepted in this version:

- A process that leaves its process group (for example with `setsid` or a double fork into a new session) escapes the kill and could watch scoring.
- A shell command can still write to a temporary path it names literally, such as `/tmp/x`, instead of `$TMPDIR`; that file is not deleted with the fork.
- Process groups are tracked by number. A group that empties while its attempt keeps running is forgotten when the attempt next starts a command, but until then its number could be reused by an unrelated group, which the kill would then reach.

## Outcomes

| Outcome | Meaning |
| --- | --- |
| `applied` | The winner's diff was applied to the workspace. |
| `ready` | A winner exists, but the workspace changed during the search or `apply` is `report`. The report gives a `git diff … \| git apply --3way` command that brings the winner in. |
| `no survivor` | No attempt passed every gate. |
| `aborted: <reason>` | The search stopped early: `no git history`, `scorer invalid`, `enumeration failed`, `cancelled`, or `error`. |

The report's first line is the summary, for example `Branch search bs-20261004-142233-9f1c: applied. 1 of 3 branches survived over 1 generations.` The chat shows that line; expanding the message shows the winner, its objective values, every attempt with its fate and one-sentence lesson, and the record path. The message starts no turn.

## Workspace and record

Each search keeps its state under `$(git rev-parse --git-common-dir)/apple-pi/branch-search/<search-id>/`. The search snapshots the workspace, including uncommitted and untracked files, as a base commit without touching your index. Worktrees live under `wt/` there and are removed when the search ends, on success, cancel, or error.

After the search, the directory keeps:

- `record.json`: mode, goal, seed, configuration, base, the scorer's hash, validation reports and review, every approach list with the attempt it continues and its cost, every planning step, every attempt with its parent, generation, start and end order, approach, constraint, commits, self-report, gate and objective results, and token cost, plus the winner and outcome.
- `spec.json`: the frozen scorer; its SHA-256 equals the hash in the record.
- `winner.patch`: the applied diff, when the winner was applied.

Refs under `refs/apple-pi/branch-search/<search-id>/` keep the base and the winner; the other attempt refs are deleted.

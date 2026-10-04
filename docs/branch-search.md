# Branch search

A single agent run follows the path its model finds most likely. When that path is wrong, the agent tends to repeat variants of the same mistake. Branch search tries several approaches side by side and keeps the one that passes acceptance checks written before any attempt exists.

When a search runs, the harness:

1. Asks a fork of the conversation to write the acceptance checks (the **scorer**), validates them on the current workspace, and freezes them.
2. Asks another fork for a list of distinct approaches. When you give a goal, the enumerator prompt and every attempt's directive state it.
3. Uses its own random draw, not the model's preference, to choose which approaches run.
4. Runs each chosen approach as a fork of the conversation in its own git worktree. Every fork shares the parent's prompt-cache prefix.
5. Scores every attempt with the hidden checks, ranks the survivors, and applies the winner's diff to the workspace.
6. Adds one passive message with the report to the conversation.

The extension loads only in the root session. Subagents and `pi_exec` workers do not load it.

## Commands

- `/branch-search [goal]` starts a search. `goal` is free text that states the observable result that must hold when the work is done. Without a goal, the scorer author infers it from the conversation.
- `/branch-search status` prints the search ID, phase, branch counts per state (running, stopped, survived, dead), and elapsed time.
- `/branch-search cancel` cancels the search. The search ends `aborted: cancelled` and cleans up.

Only one search runs per session. Starting another while one runs prints the active search ID and starts nothing.

The search forks the conversation as it stands when the search starts. If the main agent is running when you issue the command, the status line shows `branch search queued`, and the search starts when that run settles.

While the search runs, the status line shows `branching <phase> <alive>/<total>`. Phases: `author`, `validate`, `review`, `enumerate`, `run g0`, `score g0`, `apply`.

Before it applies a winner, the search waits until the main agent is not running. From then until apply, and any rollback, has finished, the main agent's `write`, `edit`, `bash`, and `pi_exec` calls fail with `Branch search is applying its winner to the workspace. Retry this call in a moment.` Cancel works during the wait.

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
| `branches.perGeneration` | integer ≥ 1 | yes | Approaches that run. |
| `branches.maxTotal` | integer ≥ 1 | yes | Upper bound on attempts in one search. |
| `generations.maxDepth` | integer ≥ 0 | yes | Generations after the first. Set `0`: later generations are not available yet. |
| `generations.rootsPerGeneration` | integer ≥ 0 | yes | New approaches per later generation. |
| `generations.parentsPerGeneration` | integer ≥ 1 | yes | Failed attempts that later generations continue. |
| `generations.childrenPerParent` | integer ≥ 1 | yes | Continuations per failed attempt. |
| `branch.limits` | `{ wallClockSec?, outputTokens? }` | yes, at least one field | Limits per attempt. An attempt over a limit stops, and its work is still scored. |
| `scorer.validationRetries` | integer ≥ 0 | yes | Corrections the author may make to checks that fail validation. |
| `scorer.reviewProfile` | model profile name | no | A [model profile](model-profiles.md) that reviews the checks once. |
| `fidelity.profile` | model profile name | no | Reserved for evaluation. |
| `constraints` | string[] | yes | Extra constraints the draw may add to an approach. The harness adds `none`. |
| `workspace.cloneIgnored` | string[] | yes | Ignored directories cloned into each worktree, for example `["node_modules", ".venv"]`. |
| `apply` | `"auto"` or `"report"` | yes | `auto` applies the winner when the workspace did not change during the search. |
| `draw` | `"random"` | no | How approaches are chosen. Defaults to `"random"`. |

Example:

```json
{
  "passive": { "enabled": false, "repeatThreshold": 3 },
  "enumerate": { "count": 4 },
  "branches": { "perGeneration": 3, "maxTotal": 3 },
  "generations": { "maxDepth": 0, "rootsPerGeneration": 0, "parentsPerGeneration": 1, "childrenPerParent": 1 },
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

## Keeping the scorer hidden

Attempts cannot see the checks that judge them. The harness keeps them apart in time rather than by guarding paths, because a shell can reach any path indirectly:

- While the enumerator or any attempt runs, no scorer file exists on disk, no scorer command runs, and the scorer is in no prompt. The scorer lives only in the harness's memory.
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

- `record.json`: mode, goal, seed, configuration, base, the scorer's hash, validation reports and review, every approach list, every planning step, every attempt with its approach, constraint, commits, self-report, gate and objective results, and token cost, plus the winner and outcome.
- `spec.json`: the frozen scorer; its SHA-256 equals the hash in the record.
- `winner.patch`: the applied diff, when the winner was applied.

Refs under `refs/apple-pi/branch-search/<search-id>/` keep the base and the winner; the other attempt refs are deleted.

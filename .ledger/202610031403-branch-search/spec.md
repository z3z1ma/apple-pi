# Branch Search: Design Specification

Status: ready for implementation. Section 15 records the verification answers (2026-10-03). The work is split into tickets in `tickets/`; start with `tickets/01-worktree-forks.md`. Decisions and planned deviations from this text are in `task.md`.

Audience: an engineer or coding agent who has never seen the discussion that produced this design. You need only this document and the apple-pi repository.

---

## 1. Summary

A single agent trajectory follows the most probable path of its model. When that path is wrong, the agent repeats variants of the same mistake. AlphaGo solved the equivalent problem with search: a policy network proposed moves, and a separate search process tested moves the policy rated as unlikely.

Branch search adds that search process to apple-pi. When it activates, the harness:

1. Pre-registers objective acceptance checks (the **scorer**) before any attempt exists.
2. Asks the model for a list of distinct approaches.
3. Uses external randomness to choose which approaches get compute. The model has no vote.
4. Runs each chosen approach as a forked continuation in its own git worktree. Every fork shares the parent's prompt-cache prefix.
5. Kills attempts that fail the hidden checks, ranks the survivors by objective measurements, and, while no attempt survives, starts new attempts: fresh approaches from the unused list, and continuations of dead attempts from their last state.
6. Applies the winning diff to the user's workspace and appends one message to the parent conversation.

The user sees one status indicator while the search runs and one message when it ends. The parent transcript stays append-only.

## 2. Goal and acceptance criteria

The feature is complete when all of these hold:

- **A1.** Each of the three activation modes (section 5) starts a search, and the search ends with exactly one of the outcomes in section 6.10.
- **A2.** No attempt can read the scorer or the files it installs. A test proves that a branch which searches the filesystem for the scorer finds nothing.
- **A3.** No attempt changes the parent workspace. A test with two concurrent branches proves that each branch's writes land only in its own worktree.
- **A4.** The first provider request of every branch reports a cache read covering the parent's prefix (for Anthropic, `cache_read_input_tokens` > 0 on the first request).
- **A5.** Given the same seed, the same candidate list, and the same configuration, the draw produces the same branch assignments.
- **A6.** On the fixture repository (section 16), a search whose most likely approach fails and whose less likely approach passes applies the passing approach's diff.
- **A7.** Every search writes a complete record (section 12) that a reviewer can use to reconstruct what happened and why.
- **A8.** Replaying a search's own configuration on its record (section 18.1) reproduces the search's steps and outcome.

## 3. Terms

| Term | Meaning |
|---|---|
| Search | One complete run of this feature, from trigger to cleanup. Identified by a search ID. |
| Base | A commit object that captures the parent workspace at search start, including uncommitted and untracked (non-ignored) files. |
| Scorer | The pre-registered acceptance spec: gates, objectives, installed files, protected paths. |
| Gate | A shell command. Exit code 0 means pass. A branch that fails any gate is dead. |
| Objective | A shell command that prints one number. Objectives rank surviving branches. |
| Candidate | One approach in the list the enumerator returns. |
| Directive | The prompt the harness appends to a fork to start a branch. It names the candidate and any perturbation. |
| Perturbation | A randomly drawn modification of a directive, such as a constraint. |
| Branch | One attempt: a forked continuation running in its own worktree under one directive. |
| Generation | The set of branches that one planning step starts together. Generation 0 holds roots only. |
| Root | A branch that starts from the base and the parent fork point. Any generation can start roots. |
| Child | A branch that continues a dead branch from that branch's commit and conversation. |
| Node key | The stable identity of a branch, derived from how it was drawn: `r<i>` for the root at position `i` of the root draw order, `<parent key>.c<j>` for the child at position `j` of its parent's draw order. The node key is also the branch ID. |
| Replay world | A finished search record, read as the tree of every realized node with its outcome and cost (section 18.1). |
| Survivor | A branch that passes every gate. |
| Role fork | A forked continuation that serves the search itself: the scorer author or the enumerator. |
| State directory | `$(git rev-parse --git-common-dir)/apple-pi/branch-search/<search-id>/`. Holds the scorer, records, and worktrees. |

## 4. Invariants

Every part of the implementation preserves these. Each invariant has a test in section 16.

- **I1. Pre-registration.** The harness freezes the scorer, and records its SHA-256, before it starts the enumerator or any branch. A search never changes its scorer. A new scorer means a new search.
- **I2. Hidden scorer.** No branch, enumerator, or child receives the scorer, its files, or its gate and objective commands in any prompt, tool result, or readable path.
- **I3. External selection.** The harness RNG chooses which candidates and perturbations run. The model's own preference is recorded for evaluation and never used for the draw (except in the evaluation arm `draw: "model"`, section 11).
- **I4. Prefix identity.** Every fork sends a request whose bytes, up to the fork point, equal the request bytes of the conversation it forks from. All variation is appended after the fork point.
- **I5. Isolation.** Each branch and role fork reads and writes only its own worktree. Writes that resolve to the parent workspace are blocked.
- **I6. Objective truth.** A branch's self-report (`done` or `abandoned`) never decides its fate. The scorer runs on every branch that produced a commit.
- **I7. Append-only parent.** The search adds at most one custom message (human and passive modes) or one tool result (agent mode) to the parent conversation.
- **I8. Correctness before preference.** Objectives rank only survivors. A dead branch never outranks a survivor.

## 5. Activation

All three modes call the same orchestrator entry point:

```ts
startSearch({ mode: "human" | "agent" | "passive", goal?: string, seedGate?: string, forkPoint })
```

Only one search runs per root session. A trigger that arrives while a search runs gets the response defined for its mode below.

### 5.1 Human: `/branch-search`

Use: the user judges that the current direction is uncertain and wants alternatives explored.

- `/branch-search [goal]` starts a search. `goal` is free text. Without a goal, the scorer author infers the goal from the conversation.
- `/branch-search status` prints the search ID, phase, branch counts per state, and elapsed time.
- `/branch-search cancel` cancels the active search and runs cleanup.

Fork point: the parent's last settled state, identical to existing forked continuations (`agent_settled`). If the root run is streaming when the user issues the command, the harness queues the search, shows `branch search queued`, and starts it at the next `agent_settled`.

If a search is already active, the command prints the active search ID and does nothing else.

### 5.2 Agent: `search_branches` tool

Use: the main agent reaches for search the way it reaches for `ask_consultant`, but for implementation alternatives instead of review.

Tool definition:

```ts
{
  name: "search_branches",
  description:
    "Explore several independent implementation approaches in parallel and keep the one that passes objective acceptance checks. " +
    "Use this when two or more approaches are plausible, when you are uncertain which direction is correct, or after an approach has failed. " +
    "The harness writes hidden acceptance checks, runs each approach in an isolated worktree, applies the winning change to the workspace, and returns the outcome. " +
    "State the goal as the observable result that must hold when the work is done.",
  parameters: {
    type: "object",
    properties: {
      goal: { type: "string", description: "The observable result that must hold when the work is done." }
    },
    required: ["goal"]
  }
}
```

Behavior:

- The tool call blocks until the search ends. It streams progress text through Pi's tool update callback (V6) using the status format in section 13.
- Fork point: the parent conversation **including** the assistant message that contains this tool call. Each role fork and each generation-0 branch appends a tool result for this tool call ID whose content is that fork's prompt (section 10). This keeps the parent's request bytes as the prefix (I4). Requires V3.
- The tool's own result, returned to the main agent, is the report body from section 6.10.
- Branches, role forks, and `pi_exec` never see this tool.
- If a search is already active, the tool returns `Branch search <id> is already running.` immediately.
- If the user aborts the tool call, the harness cancels the search and runs cleanup.

### 5.3 Passive: repeated failure

Use: the agent is stuck in a loop on the same failure.

Failure signature. The detector listens to tool results of the root run (V5). It considers only shell-executing tools (`bash` and any tool that reports an exit code). For a result with a non-zero exit code:

1. `command` = the command string with runs of whitespace collapsed to one space.
2. `line` = the first output line that matches `/error|fail|exception|panic|assert/i`, else the last non-empty output line.
3. Normalize `line`: replace each absolute path with its basename, each run of digits with `#`, each run of 6 or more hex characters with `#`.
4. `signature = sha256(command + "\n" + exitCode + "\n" + line)`.

The detector keeps, per root session, a count per signature. When the same normalized `command` later exits with code 0, the detector deletes all signatures for that command.

Trigger rule. At each root `agent_settled`, if passive mode is enabled, no search is active, and some signature has a count of at least `passive.repeatThreshold` and has not yet triggered a search in this session, the harness starts a passive search with `seedGate` set to that signature's command. Each signature triggers at most once per session.

Fork point: the parent's last settled state, as in human mode.

The same detector runs inside branches (section 6.7) with the branch's own counts.

## 6. Lifecycle

```
PREPARE → AUTHOR → VALIDATE → ENUMERATE → DRAW → RUN ⇄ SCORE → SELECT → APPLY → REPORT → CLEANUP
```

Any phase can end the search early with an outcome from 6.10. CLEANUP always runs.

### 6.1 Prepare

1. Check that the workspace is a git repository with a `HEAD` commit. Otherwise end with `aborted: no git history`.
2. Create the search ID: `bs-<YYYYMMDD-HHMMSS>-<4 hex>`.
3. Create the state directory.
4. Generate the seed: 32 bytes from `crypto.randomBytes`, stored as hex in the record.
5. Snapshot the base without touching the user's index:

   ```bash
   tmp_index=$(mktemp)
   GIT_INDEX_FILE=$tmp_index git read-tree HEAD
   GIT_INDEX_FILE=$tmp_index git add -A
   tree=$(GIT_INDEX_FILE=$tmp_index git write-tree)
   base=$(git commit-tree "$tree" -p HEAD -m "branch-search <id> base")
   git update-ref refs/apple-pi/branch-search/<id>/base "$base"
   rm "$tmp_index"
   ```

6. Record `base.commit` and `base.tree`.
7. Show the status indicator.

### 6.2 Author the scorer

The scorer author is a role fork of the parent at the fork point, running in its own worktree created from the base (section 8.4). It shares the parent's prefix. It has the full conversation, so it knows the task better than any separate model could.

It receives the prompt in section 10.1 and replies with a JSON scorer spec (section 7). The harness parses the reply and stores it as `spec.json` in the state directory.

If `scorer.reviewProfile` is set, the harness sends the spec, the goal, the seed gate, and the output of `git diff HEAD <base> --stat` to that model profile with the prompt in section 10.5. The reviewer returns `confirm` or `refine` with a replacement spec. A `refine` replaces the spec once. The review uses different weights to catch blind spots of the author; it does not share the prefix.

The author's worktree is discarded after this phase.

### 6.3 Validate the scorer

The harness validates the spec in a fresh worktree created from the base:

1. Install `files` and restore `protect` paths (section 7.3).
2. Run every gate twice. Each gate's two results must match each other, and must match its declared `onBase`.
3. Run every objective `repeat` times (default 1). Each run must print a finite number on its last non-empty stdout line. Record the median as the base value.
4. If no gate has `onBase: "fail"`, the spec must have at least one objective. In that case, survivors must also strictly beat the base value of the first objective (section 6.8).

On failure, the harness sends the validation report back to the author fork as a new message in the author's own conversation and asks for a corrected spec. It repeats up to `scorer.validationRetries` times. If the spec still fails, the search ends with `aborted: scorer invalid`.

After validation, the harness computes `sha256(spec.json)`, stores it in the record, and treats the spec as frozen (I1).

### 6.4 Enumerate

The enumerator is a role fork of the parent at the fork point, in its own base worktree. It receives the prompt in section 10.2 and returns:

```json
{
  "candidates": [{ "id": "c1", "approach": "…", "firstStep": "…" }],
  "preferred": "c1"
}
```

The harness rejects a reply that is not valid JSON or has fewer than two candidates, and asks once more. A second failure ends the search with `aborted: enumeration failed`.

`preferred` is recorded for evaluation only (I3).

### 6.5 Draw

Every random number derives from the seed and a label that names what is drawn. A draw therefore does not depend on how many other draws came before it, and the same node gets the same candidate and constraint under every configuration. Replay needs this (section 18.1).

```
u64(label, i) = first 8 bytes, big-endian, of sha256(seedBytes || utf8(label) || uint32be(i))
```

To draw an integer in `[0, n)` for a label, take `u64(label, 0)`, `u64(label, 1)`, … with rejection sampling to avoid modulo bias.

- **Draw order of an enumeration.** Each enumeration has a key: `root` for the enumeration of the parent conversation, or the node key of the dead branch it continues. A Fisher-Yates shuffle over the candidate array in returned order gives its draw order; position `p` uses label `order/<enumeration key>/<p>`. Position `p` holds the same candidate however many positions a configuration uses. With `draw: "model"`, the draw order is the enumeration's `preferred` candidate first, then the other candidates in returned order, and no seed is used for the order.
- **Constraint of a node.** Label `constraint/<node key>` draws one entry from the constraint pool (section 11). The pool always contains the entry `none`.

The seed and the node key reproduce every draw, so the record stores no separate draw log.

### 6.6 Run branches

For each branch:

1. Create its worktree from its start commit: the base for a root, the parent's commit for a child.
2. Start a forked continuation from its fork point (the parent fork point for a root, the parent branch's conversation for a child), with cwd bound to the worktree (section 8) and the directive from section 10.3 (root) or 10.4 (child) appended. Record the node's start order (section 12).
3. Apply the branch tool policy (section 8.5).
4. Run the in-branch failure detector (section 5.3 rules, branch-scoped counts). When a signature reaches `passive.repeatThreshold`, abort the branch run (V4). The branch then counts as settled with self-report `stalled`.
5. Stop the branch when it settles, or when it exceeds `branch.limits` (section 11). An exceeded limit aborts the run and sets self-report `limit`.
6. Parse the final assistant message for `result: done` or `result: abandoned` and `learned: <sentence>`. Missing lines give self-report `unknown`. A run that ends on a provider error, including context overflow, gives self-report `error`; forks do not compact or retry (decision 2026-10-03), and I6 still scores the commit.
7. Commit the worktree state:

   ```bash
   git -C <wt> add -A
   git -C <wt> -c user.name=apple-pi -c user.email=apple-pi@localhost \
     commit --no-verify --allow-empty -m "branch-search <id> <branch>"
   git update-ref refs/apple-pi/branch-search/<id>/<branch> "$(git -C <wt> rev-parse HEAD)"
   ```

Branches of one generation run concurrently. Pi's existing fork concurrency applies.

If `fidelity.profile` is set, the harness sends the directive and `git diff <start> <commit>` to that profile with the prompt in section 10.6 and records `faithful` and `reason`. Fidelity is a tag for evaluation. It never kills a branch.

### 6.7 Score and plan the next step

After every branch of a generation has committed:

1. For each branch, in its own worktree, install `files` and restore `protect` (section 7.3). Run all gates. A gate that fails or times out marks the branch dead. Record the number of gates passed.
2. For each surviving branch, run the non-serial objectives, then the built-in `diff_size` objective (section 7.4).
3. Run all `serial: true` objectives one branch at a time, after every other command of the generation has finished, so that concurrent load does not distort timings.
4. Any objective that exits non-zero, times out, or prints no finite number marks the branch dead.

Then the harness calls the planning function and acts on its result: `stop` goes to SELECT or ends the search with `no survivor`; `enumerate` runs the requested enumerator forks and plans again; `run` starts the batch as the next generation (6.6).

#### Planning function

One pure function decides every step. The orchestrator calls it online. Replay calls it offline on stored records (section 18.1).

```ts
type Step =
  | { kind: "stop"; outcome: "survivor" | "no survivor" }
  | { kind: "enumerate"; parents: NodeKey[] }
  | { kind: "run"; batch: { key: NodeKey; parent: NodeKey | null; candidate: string; constraint: string }[] };

function planStep(tree: ObservedTree, shape: SearchShape, draw: "random" | "model", seed: Uint8Array): Step;
```

`ObservedTree` holds the enumerations so far (candidates and `preferred` per enumeration key) and every scored node (key, parent, generation, status, gates passed, objectives, `diff_size`). `SearchShape` holds the tree-shape keys of section 11. The function reads nothing else: no clock, no filesystem, no shared RNG state.

Rules, in order:

1. No node yet: run the first `branches.perGeneration` positions of the `root` draw order, or all positions if the enumeration has fewer candidates.
2. A node of the latest generation survived: stop with `survivor`.
3. `generations.maxDepth` generations after generation 0 have run: stop with `no survivor`.
4. Parents: rank the dead nodes of the latest generation by gates passed (more first), then `diff_size` (smaller first), then node key. Take the first `generations.parentsPerGeneration`. If a parent has no enumeration yet, return `enumerate` with every such parent.
5. Batch: the next `generations.rootsPerGeneration` unused positions of the `root` draw order, then, for each parent in rank order, the first `generations.childrenPerParent` positions of its draw order. Trim the batch from the end so the total node count stays within `branches.maxTotal`.
6. Empty batch: stop with `no survivor`. Otherwise return `run`.

An enumerator for parent `K` is a fork of `K`'s conversation in a worktree created from `K`'s commit, with the prompt in section 10.2, so its candidates reflect what that branch learned. A root shares the parent's cache. A child's prefix equals its parent branch's conversation, so it shares that branch's cache.

Children learn only that hidden checks rejected the state. They never learn which check failed (I2).

### 6.8 Select

Among all survivors of the final generation:

1. If the spec has no `onBase: "fail"` gate, remove survivors whose first objective does not strictly beat its base value in the declared direction. If none remain, end with `no survivor`.
2. Sort survivors lexicographically by the spec's objectives in declared order, each in its declared direction.
3. Break remaining ties by `diff_size`, smaller first.
4. Break remaining ties by node key.
5. The first survivor is the winner.

Selection is a pure function of the tree. Replay uses the same function (section 18.1).

### 6.9 Apply

1. Wait until the root session is settled. Agent mode is already blocked inside the tool call.
2. Snapshot the current workspace tree with the procedure in 6.1 step 5 (tree only, no commit).
3. If the current tree equals `base.tree` and `apply` is `"auto"`:

   ```bash
   git diff --binary <base> <winner-commit> > <state>/winner.patch
   git apply --whitespace=nowarn <state>/winner.patch
   ```

   The outcome is `applied`.
4. If the tree differs from the base, or `apply` is `"report"`, leave the workspace untouched. Keep the winner ref. The outcome is `ready`. The report gives the merge command:

   ```bash
   git diff <base> refs/apple-pi/branch-search/<id>/<winner> | git apply --3way
   ```

The patch never contains scorer files, because the harness installs them only after the branch commit.

### 6.10 Report

Outcomes:

| Outcome | Meaning |
|---|---|
| `applied` | Winner diff applied to the workspace. |
| `ready` | Winner exists; the workspace changed during the search or apply mode is `report`. |
| `no survivor` | No branch passed all gates within the configured limits. |
| `aborted: <reason>` | The search stopped early: no git history, scorer invalid, enumeration failed, cancelled, error. |

Report body (plain text, one summary line first):

```
Branch search <id>: <outcome>. <W> of <B> branches survived over <G> generations.
Winner: <branch> (<candidate id>, constraint: <constraint>) +<added> -<deleted> in <files> files.
Objectives: <id>=<value> (base <value>), …, diff_size=<value>
Branches:
  <branch> <survived|dead (gates passed g/n)> <self-report>: <learned sentence>
  …
Record: <path to record>
```

Delivery:

- Human and passive modes: append one custom message through the forked-continuation message path. It does not start or steer a turn. The chat shows the summary line; expanding it shows the body.
- Agent mode: return the body as the tool result.

### 6.11 Cleanup

Always runs, including on cancel and error:

1. Abort every running fork of this search.
2. `git worktree remove --force` every worktree of this search, then `git worktree prune`.
3. Delete every ref under `refs/apple-pi/branch-search/<id>/` except `base` and the winner.
4. Keep the state directory files `record.json`, `spec.json`, and `winner.patch`. Delete the `wt/` directory.
5. Clear the status indicator.

Session switch and session tree navigation cancel all forks (existing behavior). Attach this cleanup to the same events.

## 7. Scorer specification

### 7.1 Schema

```ts
type ScorerSpec = {
  version: 1;
  goal: string;                       // as understood by the author
  files: { path: string; content: string }[];   // repo-relative; installed before scoring
  protect: string[];                  // repo-relative; restored to base before scoring
  gates: {
    id: string;
    run: string;                      // shell command, run with bash -lc in the worktree root
    onBase: "fail" | "pass";
    timeoutSec: number;
  }[];
  objectives: {
    id: string;
    run: string;                      // last non-empty stdout line must be one finite number
    better: "lower" | "higher";
    timeoutSec: number;
    serial?: boolean;                 // run alone, after all other commands of the generation
    repeat?: number;                  // runs per measurement; the median counts; default 1
  }[];
};
```

Validation rules beyond the type:

- `id` values are unique across gates and objectives, and match `/^[a-z0-9_-]+$/`. The id `diff_size` is reserved.
- `path` and `protect` entries are relative, contain no `..` segment, and resolve inside the worktree.
- At least one gate exists.

### 7.2 Command execution

- Shell: `bash -lc "<run>"`, cwd at the worktree root.
- Environment: the parent's environment plus `CI=1` and `APPLE_PI_BRANCH_SEARCH=<id>`.
- Timeout: the command's `timeoutSec`. On timeout, kill the process group. A timed-out gate fails; a timed-out objective kills the branch.
- Output capture: keep the last 64 KiB of stdout and stderr in the record for diagnosis.

### 7.3 Installing files and restoring protected paths

Before any gate or objective runs in a worktree:

```bash
# for each entry in files
mkdir -p "$(dirname <path>)" && write <content> to <path>
# then
git -C <wt> checkout <base> -- <protect...>
```

Order matters: the harness writes `files` first, then restores `protect`, so a protected path always holds its base content.

A branch that edited a protected file loses that edit at scoring time. This is intended: the author declared that file as part of the acceptance criteria.

### 7.4 Built-in objective `diff_size`

```bash
git diff --numstat <start-of-search-base> <branch-commit>
```

Sum added plus deleted lines over all rows. Rows with `-` (binary) count as 0 lines. Lower is better. It always runs last and serves as the final tie-break, so among correct attempts the smallest change wins.

### 7.5 What makes a usable hidden check

Branches cannot see the scorer, so a gate can only test interfaces a branch can know about: existing public functions and modules, CLI commands, HTTP routes, existing test entry points, and names the goal states exactly. The author prompt (10.1) states this rule. A gate that imports a function name the author invented kills correct branches, and validation cannot catch that, because the base fails such a gate for the correct reason too. The reviewer prompt (10.5) checks for it.

## 8. Workspace isolation

### 8.1 Worktree layout

```
<state>/wt/author
<state>/wt/enum-<enumeration key>
<state>/wt/validate
<state>/wt/<branch>          branch ids are node keys, e.g. r2, r0.c1
```

Create each with:

```bash
git worktree add --detach <state>/wt/<name> <start-commit>
```

### 8.2 Ignored directories

Worktrees contain tracked and base-captured files only. Dependency directories are ignored and missing. For each path in `workspace.cloneIgnored` that exists in the parent workspace, clone it into the new worktree:

- macOS: `cp -cR <parent>/<path> <wt>/<path>` (APFS copy-on-write clone)
- Linux: `cp -R --reflink=auto <parent>/<path> <wt>/<path>`

A branch that changes dependencies runs the install command itself. The scorer author may include an install step in a gate when the goal involves dependencies.

### 8.3 Cwd binding and path remapping

Forks today reuse the parent's tools and hooks, so every tool acts in the parent workspace. Branch search needs each fork's tools to act in that fork's worktree, while the fork's request bytes stay identical to the parent's (I4). If Pi's system prompt includes the working directory (V2), the fork must keep the parent's path in its prompt, so the tools remap paths instead.

Implementation:

1. Create an `AsyncLocalStorage<ForkContext>` in `components/shared`. `ForkContext = { searchId, role, worktreeRoot, parentRoot, blockedTools }`.
2. The forked-continuation starter runs the fork's prompt call inside `forkContext.run(ctx, …)`. V1 confirms that Pi executes the fork's tool calls inside that async context.
3. Wrap the core file tools (`read`, `write`, `edit`, `ls`, `grep`, `find`, and any other tool that takes a path):
   - Resolve the path against `worktreeRoot` when relative.
   - Replace a leading `parentRoot` with `worktreeRoot` when absolute.
   - After resolution, a **write** to any path outside `worktreeRoot` and outside the OS temp directory fails with the error `Branch search isolates this attempt to its own copy of the repository.`
4. Wrap `bash`:
   - Set the process cwd to `worktreeRoot`.
   - Replace every occurrence of `parentRoot` in the command string with `worktreeRoot`.
5. Paths in tool output appear as worktree paths. That is acceptable: output belongs to the suffix after the fork point.

Residual risk: a shell command can still construct the parent path indirectly. Section 16 includes a leak test, and the record stores the parent tree before and after each generation for audit.

### 8.4 Hiding the scorer

Decision (2026-10-03): phase separation. A path or string guard cannot meet I2, because a shell can reach the git common directory indirectly.

- The harness holds the frozen spec in memory. While any enumerator or branch runs, no scorer file exists on disk and no scorer command runs.
- Scorer files exist only in the validate worktree (removed before ENUMERATE) and in branch worktrees during SCORE (removed before the next generation runs).
- Before SCORE, the harness kills each branch's process tree, so a branch process cannot watch scoring.
- The harness writes `spec.json` and the scorer part of `record.json` only after the last branch of the search stops.
- The scorer author is the only fork that writes scorer content, and it writes it only in its reply.
- Residual risk: a detached daemon that escapes the process-tree kill. Accepted for this version.

### 8.5 Tool policy per fork role

| Tool | Scorer author | Enumerator | Branch |
|---|---|---|---|
| File and shell tools (remapped) | yes | yes | yes |
| `search_branches` | no | no | no |
| `ask_user_question` | no | no | no |
| `update_notebook`, `revisit_note` | no | no | no |
| `ledger_*` writes | no | no | no |
| Subagent tools, `ask_consultant` | no | no | no |
| `schedule`, `monitor`, `task` | no (root only today) | no | no |
| `pi_exec` | only if V8 passes | only if V8 passes | only if V8 passes |

A blocked tool call returns `This tool is not available inside a branch search attempt.` Excluding a tool from the fork's tool list would change request bytes and break I4, so the harness blocks at execution time and leaves the tool list unchanged.

Existing consumers that watch the main run (pair programmer, change review, learning reflection) skip events while `inForkedContinuation()` is true. Confirm that branch forks set this flag.

## 9. Prompt cache behavior

| Request | Model | Shares prefix with |
|---|---|---|
| Scorer author | parent model | parent, up to the fork point |
| Scorer review | `scorer.reviewProfile` | nothing |
| Root enumerator | parent model | parent, up to the fork point |
| Root branch, any generation | parent model | parent, up to the fork point |
| Enumerator of a dead branch | parent model | that branch, full conversation |
| Child branch | parent model | its parent branch, full conversation |
| Fidelity tag | `fidelity.profile` | nothing (small request) |

Notes:

- All forks reuse the parent's provider session ID, so provider routing keeps them on the cached prefix.
- In agent mode, the assistant message containing the tool call was model output and is not yet in the cache. The first fork request writes it. Concurrent first requests may each write that one message. The cost is that message's length only.
- Different model profiles never share a cache. The design uses them only for the small review and fidelity requests.

## 10. Prompts

All prompts use positive instructions. Placeholders use `{name}`.

### 10.1 Scorer author

```
Branch search: acceptance checks.

Several independent attempts will implement the current task, each in an isolated copy of this repository. None of them will ever see what you write here. Your checks decide which attempt wins.

Goal: {goal | "Infer the goal from the conversation and state it in the spec."}
{if seedGate} The command `{seedGate}` failed repeatedly. Use it as a gate with onBase "fail" if it expresses the goal. {endif}

You are working in a disposable copy of the repository at its current state. Use it to read code and to try your checks.

Write the spec with these rules:
1. Gates are shell commands that exit 0 for an acceptable result. Use onBase "fail" for a gate that detects the missing behavior. Use onBase "pass" for a gate that protects behavior that already works.
2. Test behavior only through interfaces that already exist or that the goal names exactly: public functions and modules, CLI commands, HTTP routes, existing test entry points. Attempts can only match names they can know.
3. Put new test code in "files". The harness writes these files into each attempt's copy before it runs the checks. List existing files that your checks depend on in "protect". The harness restores them to their current content before it runs the checks.
4. Objectives are shell commands whose last line of stdout is one number. Add them only when the goal values something measurable beyond correctness, such as speed or size. Order them by importance. Set "better" to "lower" or "higher". For timings, set "serial": true and set "repeat" to the number of runs whose median counts.
5. Give every command a "timeoutSec" well above its expected run time.
6. Run every check here and confirm that each result matches what you declared.

Reply with only the JSON object, matching this schema:
{schema}
```

### 10.2 Enumerator

```
Branch search: approach list.

List {count} distinct approaches to the current task. Make each approach differ from the others in mechanism, in where the change happens, or in strategy, so that every attempt explores a different direction. Include approaches you consider unlikely to be best; an independent process decides which ones run.

For each approach, give a one-paragraph description and the first concrete action an engineer would take. After the list, give the id of the approach you would choose yourself.

Reply with only JSON:
{"candidates":[{"id":"c1","approach":"...","firstStep":"..."}],"preferred":"c1"}
```

### 10.3 Root directive

```
Branch search: attempt {branchId}.

You are one of several independent attempts at the current task. This attempt has its own copy of the repository, so your changes affect only this attempt.

Approach: {approach}
First action: {firstStep}
{if constraint != none} Constraint: {constraint} {endif}

Commit fully to this approach. Work until the task is complete under it, or until you have concrete evidence that it cannot work. Make reasonable decisions on your own; the user is away. Hidden acceptance checks will judge the final state of the repository.

End your final message with exactly these two lines:
result: done | abandoned
learned: <one sentence about what this attempt revealed>
```

### 10.4 Child directive

```
Branch search: attempt {branchId}, continuing from {parentBranchId}.

Hidden acceptance checks rejected the current state of this attempt. Continue from the current state of the repository in this direction:

Approach: {approach}
First action: {firstStep}
{if constraint != none} Constraint: {constraint} {endif}

Work until the task is complete or until you have concrete evidence that this direction cannot work.

End your final message with exactly these two lines:
result: done | abandoned
learned: <one sentence about what this attempt revealed>
```

### 10.5 Scorer review (optional)

```
Review an acceptance spec for an automated search. Several attempts will implement the goal without seeing the spec. Check three things:
1. Every gate with onBase "fail" detects the goal itself, and a correct implementation would pass it.
2. Every gate uses only interfaces that exist in the repository or that the goal names exactly.
3. The gates together reject plausible wrong implementations.

Goal: {goal}
Seed gate: {seedGate | none}
Changed files at base: {diffStat}
Spec: {spec}

Reply with only JSON: {"verdict":"confirm"} or {"verdict":"refine","reason":"...","spec":{...}}
```

### 10.6 Fidelity tag (optional)

```
Directive: {approach} / First action: {firstStep} / Constraint: {constraint}
Diff:
{diff}

Does the diff implement the directive's approach? Reply with only JSON: {"faithful": true|false, "reason": "..."}
```

## 11. Configuration

Location: follow the existing apple-pi settings convention (user file under `~/.pi/agent/`, optional project override under `.pi/`). Proposed file name: `branch-search.json`.

The code carries no built-in values for limits or counts. If a required key is missing, the feature stays disabled, `/branch-search` prints the missing keys, and `search_branches` returns the same text. The operator sets initial values and tunes them with data from the evaluation (section 18).

| Key | Type | Required | Meaning |
|---|---|---|---|
| `passive.enabled` | boolean | yes | Enables passive activation. |
| `passive.repeatThreshold` | integer ≥ 2 | yes | Repeats of one failure signature that trigger passive search and in-branch stall abort. |
| `enumerate.count` | integer ≥ 2 | yes | Candidates requested from each enumerator. |
| `branches.perGeneration` | integer ≥ 1 | yes | Roots drawn in generation 0. |
| `branches.maxTotal` | integer | yes | Upper bound on branches across all generations. |
| `generations.maxDepth` | integer ≥ 0 | yes | Generations after generation 0. Zero disables dynamic branching. |
| `generations.rootsPerGeneration` | integer ≥ 0 | yes | New roots drawn from unused root positions in each generation after generation 0. |
| `generations.parentsPerGeneration` | integer ≥ 1 | yes | Dead branches that spawn children. |
| `generations.childrenPerParent` | integer ≥ 1 | yes | Children per parent. |
| `branch.limits` | `{ wallClockSec?: number, outputTokens?: number }` | yes, at least one field | Limits per branch run. |
| `scorer.validationRetries` | integer ≥ 0 | yes | Correction rounds for an invalid spec. |
| `scorer.reviewProfile` | model profile name | no | Enables scorer review. |
| `fidelity.profile` | model profile name | no | Enables fidelity tags. |
| `constraints` | string[] | yes | Constraint pool. The harness adds `none`. |
| `workspace.cloneIgnored` | string[] | yes | Ignored directories cloned into worktrees, e.g. `["node_modules", ".venv"]`. |
| `apply` | `"auto"` \| `"report"` | yes | Apply the winner automatically when the workspace is unchanged. |
| `draw` | `"random"` \| `"model"` | no, default `"random"` | `"model"` orders each enumeration preferred first, then in returned order (6.5). Evaluation only. |

The `branches.*` and `generations.*` keys form the `SearchShape` of the planning function (6.7). They are the keys replay can tune (section 18.1).

Example constraint pool, to edit freely:

```json
[
  "Add no new dependencies.",
  "Change as few files as possible.",
  "Solve it by changing a data structure rather than control flow.",
  "Delete or simplify existing code before you add code.",
  "Write a failing test that reproduces the problem before you change any source file."
]
```

## 12. Search record

`<state>/record.json`, written after each phase so a crash leaves a partial record:

```json
{
  "id": "bs-20261004-142233-9f1c",
  "mode": "agent",
  "goal": "…",
  "seedGate": null,
  "seed": "hex",
  "startedAt": "ISO-8601",
  "endedAt": "ISO-8601",
  "config": { },
  "base": { "commit": "sha", "tree": "sha" },
  "spec": { "sha256": "…", "path": "spec.json", "validation": [ { "attempt": 0, "ok": false, "report": "…" } ], "review": null, "baseValues": { "o1": 12.4 } },
  "cost": { "author": { "inputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0, "outputTokens": 0, "ms": 0 }, "review": null, "validationMs": 0 },
  "enumerations": [ { "key": "root", "candidates": [ ], "preferred": "c3", "cost": { } } ],
  "steps": [ { "seq": 0, "step": { "kind": "run", "batch": [ ] } } ],
  "branches": [
    {
      "key": "r0", "generation": 0, "parent": null,
      "candidate": "c2", "constraint": "none",
      "startSeq": 0, "endSeq": 3,
      "startCommit": "sha", "commit": "sha",
      "selfReport": "done", "learned": "…",
      "gates": { "g1": "pass", "g2": "fail" }, "gatesPassed": 1,
      "objectives": { "diff_size": 41 },
      "status": "dead",
      "fidelity": null,
      "cost": { "inputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0, "outputTokens": 0, "runMs": 0, "scoreMs": 0 }
    }
  ],
  "parentTreeChecks": [ { "phase": "after g0", "tree": "sha" } ],
  "winner": "r0.c1",
  "outcome": "applied",
  "abortReason": null
}
```

The record is a replay world (section 18.1):

- `parent`, `startSeq`, `endSeq`, and `cost` on every branch, plus `cost` on every enumeration and on the search, give the tree, its event order, and its price.
- `startSeq` and `endSeq` come from one counter per search that increments at every branch start and every branch end.
- `steps` lists every planning result in order, so replay can check that it reproduces the search (A8).

## 13. User interface

- Status indicator in the editor, using the same mechanism as `reflecting…`: `branching <phase> <alive>/<total>`. Phases: `author`, `validate`, `enumerate`, `run g<n>`, `score g<n>`, `apply`.
- Forks do not appear in `/work`; the work panel lists subagents and managed tasks only. `/branch-search status` shows the branches.

## 14. Module layout

Follow `docs/development.md` for naming and structure; adjust this layout to match it.

```
components/shared/src/
  forked-continuation.ts     extend: options { cwdRoot, role, blockedTools, fromPendingToolCall?: { toolCallId } }
  fork-context.ts            AsyncLocalStorage<ForkContext>, inForkedContinuation(), currentForkContext()

extensions/branch-search/
  index.ts                   registers command, tool, passive listener, cleanup hooks
  config.ts                  load and validate configuration (section 11)
  failure-signature.ts       normalization and counting (section 5.3)
  orchestrator.ts            lifecycle state machine (section 6)
  scorer.ts                  schema, validation, execution, overlay, diff_size (section 7)
  workspace.ts               base snapshot, worktrees, ignored-dir clone, commit, apply, cleanup (sections 6.1, 6.9, 6.11, 8.1, 8.2)
  isolation.ts               path remap, write guard, tool blocking (section 8)
  draw.ts                    keyed seeded draws (section 6.5)
  plan.ts                    planning function and selection (sections 6.7, 6.8), shared by orchestrator and replay
  replay.ts                  replay of a configuration on stored records (section 18.1)
  prompts.ts                 templates (section 10)
  report.ts                  report body, custom message (section 6.10)
  record.ts                  record writes (section 12)

tests/branch-search/
  fixtures/                  fixture repository (section 16)
```

## 15. Pi integration points to verify

Verify each item with a small spike before building on it. Record the answer in this section.

| ID | Question | Blocks |
|---|---|---|
| V1 | Do tool calls of a forked continuation execute inside the async context of the call that started the fork, so that `AsyncLocalStorage` identifies the fork? If not, what fork identifier reaches the tool layer? | Everything |
| V2 | Does Pi's system prompt include the working directory? (Determines whether path remapping is mandatory; the design remaps either way.) | Isolation design |
| V3 | Can a forked continuation start from a conversation whose last message is an assistant tool call, by appending a tool result for that call? | Agent mode |
| V4 | Can the harness abort one fork's run without affecting other forks or the parent? (`auto-compact.ts` aborts continuations; confirm the same for forks.) | In-branch stall, limits, cancel |
| V5 | Which extension event delivers tool results with exit code and output for the root run and for forks? | Passive mode, in-branch detector |
| V6 | Can a long-running tool stream progress updates to the UI? | Agent mode status |
| V7 | Can a tool wrapper return a blocked-tool result at execution time without changing the tool list? | Tool policy |
| V8 | Do `pi_exec` guest tool calls pass through the same tool implementations, and therefore through the fork context and wrappers? | `pi_exec` in forks |
| V9 | Does the notify extension expose a call other extensions can use? | Completion notification |
| V10 | What is the supported way to add an evidence file to the active ledger task bundle? | Ledger summary |
| V11 | Do branch forks report provider usage, including cache read tokens, so the record can store it? | A4, evaluation |

### Answers (2026-10-03, Pi 0.99.0, faux-model spikes in `evidence/branch-search-spike.test.ts`)

- **V1: yes.** Two concurrent forks, each started inside its own `AsyncLocalStorage.run`, each saw its own store in the extension `tool_call` hook and in the tool's `execute`. The existing `inForkedContinuation()` already depends on this.
- **V2: yes.** `pi-coding-agent/dist/core/system-prompt.js` always adds a `<cwd>` section. Forks must keep the parent's path in the prompt, so remapping is mandatory.
- **V3: yes.** When a tool's `execute` runs, `sessionManager.buildSessionProjection().messages` already ends with the assistant message that holds the call. `fork.prompt([toolResult])` sends the same system prompt, tools, and messages through that assistant message as the parent's next request. Not covered: an assistant message with sibling tool calls; the fork must then supply a result for each call.
- **V4: yes.** `Agent.abort()` on one fork stops it with `stopReason: "aborted"`; a sibling fork completes and the parent is not streaming. The faux stream must honor `options.signal` to show this.
- **V7: yes.** The fork's own `beforeToolCall` returns `{ block, reason }` (the pattern already used for `ask_user_question`). The tool list stays unchanged.
- **V9: no.** The notify component exports no call for other extensions, and it notifies on `agent_settled`, which a passive message does not start. Decision (2026-10-03): no completion notification in this version.
- **V10: none.** Apple-pi has no active-task pointer by design (`AGENTS.md`). Decision (2026-10-03): no ledger summary; the report names the record path.
- **V11: partly.** `continueFork` already appends each fork reply's provider usage to the parent session as `kind: "forked_continuation"`. Cache-read reporting on a real provider is not yet checked.
- **Finding: per-fork argument remapping needs no global tool wrapper.** The fork's own `beforeToolCall` can rewrite `context.args` before the parent's hooks and the core tool run; the fork transcript keeps the model's original arguments. Gap: `components/tasks/src/bash-tool.ts` takes its cwd from the parent `ctx.cwd`, so bash needs a fork-context lookup there or a `cd` prefix.
- **Finding: section 8.4 does not meet I2.** A branch can find the state directory through `git rev-parse --git-common-dir` or `find / -name spec.json`; the string guard on bash commands does not stop either. The A2 test in section 16 would fail. Resolved: section 8.4 now uses phase separation.

## 16. Tests

Use Vitest and the repository's existing harness test patterns. Unit tests:

- `failure-signature`: paths, digits, and hex normalize; the same failure on different line numbers produces one signature; a later success of the same command clears it.
- `draw`: a fixed seed and candidate list give a fixed draw order; rejection sampling stays within range; a draw order never repeats a candidate; position `p` is the same for any number of positions drawn; a node's constraint depends only on its key.
- `plan`: on synthetic trees, a survivor stops the search; generation 0 runs the first roots; later generations add unused roots and children of the top-ranked dead nodes; a parent without an enumeration yields `enumerate`; `maxDepth`, `maxTotal`, and an empty batch stop with `no survivor`.
- `replay`: replaying a record's own configuration reproduces its `steps` and outcome (A8); a configuration that needs an unrealized node or enumeration is unevaluable on that record.
- `scorer` schema: reserved id, duplicate id, `..` path, and missing gate fail validation.
- `scorer` validation: an `onBase: "fail"` gate that passes on base is rejected; a gate with different results on two runs is rejected; a non-numeric objective is rejected.
- `scorer` overlay: installed files appear; protected files hold base content even when the branch edited them.
- `diff_size`: binary rows count as 0.
- `select`: survivors rank by objectives in order and direction, then `diff_size`, then id; the no-fail-gate rule removes survivors that do not beat base.
- `apply`: unchanged workspace applies; changed workspace yields `ready` and leaves files untouched.

Integration tests on a fixture repository with:

- a module with a bug, a failing test that reproduces it, and two plausible fixes, where the "obvious" fix fails a second hidden case;
- scripted model responses (use the repository's existing test provider or fake model pattern).

Integration cases:

- **Isolation (A3):** two concurrent branches write the same relative path with different content; each worktree holds its own content; the parent file is unchanged; a branch command using the parent's absolute path writes into its worktree.
- **Hidden scorer (A2):** a branch runs `find / -name spec.json` and `grep -r` for a gate command string; neither finds the active search's scorer.
- **Prefix sharing (A4):** with a recording provider stub, the first request bytes of each branch start with the parent's last request bytes.
- **End to end (A6):** human mode applies the passing fix; agent mode returns the report as the tool result; passive mode triggers after the configured repeats.
- **Dynamic branching:** generation 0 has no survivor; the child of the dead branch with more gates passed survives and wins.
- **Cleanup:** after success, cancel, and an injected error, no worktree of the search remains and only `base` and winner refs remain.

## 17. Delivery phases

The tickets in `tickets/` replace this table for execution. It stays here as the original phase plan.

Each phase ends with a commit and passing `npm run check` and `npm test`.

| Phase | Scope | Done when |
|---|---|---|
| P1 | Answer V1, V2, V4, V5, V7, V11. Build `fork-context.ts`, cwd binding, path remap, write guard. | Isolation test passes; a fork's first request shows a cache read. |
| P2 | Human mode, generation 0 only. Scorer is a fixed spec from a test fixture. Draw, run, score, select, apply, report, cleanup, record. | End-to-end human case passes with the fixed spec. |
| P3 | Scorer author, validation loop, freeze, optional review. Phase separation for the scorer (8.4). | Hidden-scorer test passes; validation tests pass. |
| P4 | Answer V3, V6. Agent mode tool. | Agent end-to-end case passes. |
| P5 | Passive detector and trigger. In-branch stall abort. | Passive end-to-end case passes. |
| P6 | Planning function (6.7) with roots and children; dynamic branching. | `plan` tests and dynamic branching test pass. |
| P7 | Replay (18.1), evaluation harness (section 18). Documentation (section 20). | Replay reproduces every stored record; first evaluation report exists. |

## 18. Evaluation

The feature exists to beat a single trajectory. Measure that on real work.

Task set: closed tasks in `.ledger/history/`. For each task:

- Base: the commit before work on the task started.
- Goal: the task's `task.md`.
- Oracle gates: tests added or changed by the task's final commits that fail on the base and pass on the final state.

Arms, same model and task:

- **A.** Single trajectory: the main agent, no search.
- **B.** Branch search with `draw: "model"`.
- **C.** Branch search with `draw: "random"`.

Run B and C twice: once with oracle gates as the scorer (measures search alone), once with the authored scorer (measures the full system). Score every arm's final state with the oracle gates.

Record per task and arm: solved, total tokens, cache read tokens, wall-clock time, and for C the winner's candidate rank relative to `preferred`.

A **tail win** is a solved task in arm C whose winning candidate is neither `preferred` nor among the candidates arm B would have drawn.

Success criteria:

- C solves more tasks than A.
- C solves at least as many tasks as B.
- Tail wins occur. If C beats A only on tasks where the winner was the model's preferred candidate, the gain comes from retries, and external selection adds nothing.

Report cost next to every result. The operator decides whether the solve rate justifies the cost.

### 18.1 Replay tuning

Source: Dream-RSI (https://github.com/zhengkid/Dream-RSI). A finished search tree records every realized node, its outcome, and its cost. Another configuration can be evaluated on it by reading stored outcomes instead of running the model or the scorer again.

Why replay is valid here. A node's outcome depends only on its key: a root on its candidate, constraint, base, and fork point; a child on its parent's state and its own draw. Keyed draws (6.5) give a key the same candidate and constraint under every configuration. A configuration's search on a world is therefore the set of keys the planning function requests, and replay reads each key's outcome from the record.

A world is a record whose search ended with `applied`, `ready`, or `no survivor`.

Replay of configuration C on world W:

1. Start with W's seed, W's `draw` mode, W's `root` enumeration, and no nodes.
2. Call `planStep` (6.7) with C's tree-shape keys.
3. Serve each `enumerate` and `run` request from W. If W lacks a requested enumeration or node, C is unevaluable on W.
4. On `stop`, apply selection (6.8) to the replayed tree.
5. Result: solved (a survivor exists), the winner's objectives, tokens (W's search-level cost plus the enumerations and nodes C used), and wall-clock (per generation, the longest `runMs + scoreMs`, summed over generations).

Tunable keys: `branches.perGeneration`, `branches.maxTotal`, `generations.maxDepth`, `generations.rootsPerGeneration`, `generations.parentsPerGeneration`, `generations.childrenPerParent`. The other keys change what the model or the scorer produces, so replay cannot evaluate them. Records of `draw: "model"` searches replay only under `draw: "model"`.

Tuning:

1. The operator decides when enough records exist and gives a list of values for each tunable key. The current configuration is always in the grid.
2. Replay every grid configuration on every world. Report, per configuration, the worlds where it is unevaluable.
3. Compare configurations on the worlds where all of them are evaluable. Rank by solved count, then total tokens (lower first), then wall-clock (lower first). The current configuration wins ties, so tuning never adopts a configuration that replays worse.
4. The operator sets the winning values in `branch-search.json`.

Limits:

- Replay sees only realized nodes. A configuration larger than the recorded trees is unevaluable, so tuning can shrink a configuration, and can grow it only after searches that ran with larger values.
- Each node's outcome is one sample from a stochastic model. Replay treats it as the outcome.

## 19. Out of scope for this version

- Branches on different models or providers. They cannot share the cache and need cross-provider history conversion.
- Refinement generations that improve objectives after survivors exist.
- Withholding unread files from branches as a perturbation.
- Adaptive exploration based on measured scorer strength, including mutation testing of the scorer.
- Subagents inside branches.
- `pi_exec` inside branches, unless V8 passes.

## 20. Repository changes outside the extension

- `docs/branch-search.md`: user-facing behavior (activation, configuration, outcomes, record). Write it from this spec once P2 lands.
- `docs/boundaries.md`: amend "No Git Worktree Circus for Subagents" with a narrow exception: branch search creates and removes its own worktrees under the git common directory, and nothing else in the harness manages worktrees.
- `docs/forked-continuations.md`: document the new options (`cwdRoot`, `role`, `blockedTools`, `fromPendingToolCall`) and the fork context.
- `README.md`: add branch search to the core paradigms and the commands table.

# First-class review

apple-pi's `review` extension seals a Git change, asks one planner to cut it into file partitions and concrete focuses, runs those focuses as fresh read-only agents in parallel, then has one verifier write decisions and a meta-review. The same controller supplies Ralph's independent review stage.

## Commands

```text
/review                         # run a workspace review
/review preview                 # inspect workspace scope without model calls
/review preview components/review
/review run workspace components/review "**/*.ts"
/review run workspace --path src/controller.ts
/review run workspace --root ../feature-worktree
/review run range --root repos/service-a --from main --to HEAD
/review run commit --commit abc123
/review run --profile fast
/review run --profile thorough --background "Prioritize migration compatibility."
/review status [run-id]
/review stop <run-id>
```

The `review` tool exposes the same `preview`, `run`, `status`, and `stop` actions. Normal tool and command calls accept semantic source, profile, routing, background intent, and optional `paths`. `paths` are repository-relative files, folders, or globs that limit which changes are sealed. Omitted or empty `paths` reviews the whole workspace, range, or commit. Leftover `/review` arguments and `--path` are the command form of the same list. Its optional `root` selects the Git repository or linked worktree to review; relative paths resolve from the caller's cwd. Tool results include the full structured run; the text result is a bounded summary grouped by path. A completed human `/review run` sends that summary back to the current model as a displayed follow-up.

Review execution requires a trusted project and an active model. Preview performs only local Git/file inspection.

## Pipeline

1. Resolve the Git repository root and source.
2. Freeze range/commit refs and materialize a read-only review tree, or hash the workspace input. Caller files, folders, and globs limit which changes enter that seal; unrelated dirty files stay out of the input hash. A folder matches itself and descendants. A glob matches the repository path. A file matches exactly. Renames match if the old or new path matches.
3. Separate reviewable text changes from visible waivers. Binary and non-text items are waived. `.ledger/` stays in the sealed tree for context and is waived from selected coverage.
4. Ask one fresh low-thinking planner to cut the selected files. Its only productive tool is `open_review({ files, focuses[] })`, which it may call several times. Planning is classification, not review. It may read or grep to understand a relationship.
5. After the planner exits, launch every focus in parallel under the concurrency cap (default 6). Reviewers are independent read-only lenses; they may share files. Each reviewer is a full read-only agent with a bound `report` tool whose finding `path` is one of the assigned files. Lined reports are exact when those line numbers exist. The controller attaches the cited lines; reviewers do not have to reproduce them.
6. After every reviewer in the cycle finishes, run one rigorous verifier over the whole pile. It receives the attached lines and precomputed path/side/line clusters. It decides each finding and writes a meta-review: sentiment, compound risks, residuals, and coverage gaps. A reject that a careful reader could believe because the code or docs omit the real rule is a clarity residual for later cycles.
7. Distinct findings that share a path or line stay distinct. Presentation groups them by path. Clusters exist so the verifier can name compound risk without merging. Old-side and new-side claims on the same path stay in separate clusters.
8. `fast` and `balanced` are one cycle. `thorough` may loop the same process up to three times; later planners see prior focuses, findings, and the meta-review, and must not repeat the same investigation.
9. A selected file is incomplete if no cycle opened a review covering it, or if every focus that covered it failed. One failed sibling focus does not fail a file another focus already covered. A first-cycle verification miss does not publish `complete` even when every selected file was covered. Extra-cycle failure after a complete first pass does not un-complete the run. Error paths still coverage-account every selected file before the run settles.

Planner and reviewer prompts identify items by unique repository paths, with a status suffix only when two selected items share a path. The controller resolves those aliases to sealed identities. Fail a role closed before launch only when its rendered prompt cannot fit the model context window or remaining elapsed time is exhausted.

## Profiles and model routing

Profile selects how many plan → review → verify cycles to allow:

- `fast`: one cycle, tighter focus and time caps.
- `balanced` (default): one complete cycle with more room to cut.
- `thorough`: up to three cycles. Reviewers stay on the routine route with low thinking. The verifier always uses the rigorous route.

`.ledger/` stays in the sealed tree so reviewers can read it for context. It is waived from selected coverage and is not a review subject.

Routes are ordinary apple-pi modes `review-planner`, `review-routine`, and `review-rigorous`. A trusted project's `.pi/modes.json` wins over global `~/.pi/agent/modes.json`. Missing entries defer to the caller's active model. `planner_mode`, `fast_mode`, and `strong_mode` can override the mode names per run.

## Finding contract

Each finding records severity, summary, impact, attached cited lines, path, optional line range, side, and a verifier decision. Notes are residuals, not findings. The verifier rejects only with concrete counterevidence. A rejected finding that the code or docs invited becomes a clarity residual. Rejected findings stay in the receipt and are hidden from the normal summary.

## Trust, mutation, and persistence

Planner, reviewer, and verifier receive only `read`, `grep`, `find`, and `ls`. Extensions and skills are disabled, the role prompt replaces inherited context, nested delegation is disabled, and a call-time path policy blocks reads outside the selected review root or inside `.git`.

An explicit review root must resolve to a Git working tree contained by the trusted directory, sharing its Git common directory, or linked as a worktree of the current repository.

A workspace review does not require a clean checkout. If the selected workspace changes during execution, publication stops with `workspace_conflict`. Range and commit reviewers read a temporary sealed tree, not the live checkout.

A live project lease prevents two Pi processes from reviewing the same project concurrently. Receipts are append-only JSONL under `$PI_CODING_AGENT_DIR/reviews/runs/<project-hash>/<run-id>.jsonl`.

## Harness-owned limits and outcomes

After sealing input, the controller derives focus, cycle, concurrency, and time caps. Review does not refuse or abort work for token spend or turn count. A limit never converts incomplete work into success. Historical receipts that still contain unused token-admission or turn-budget fields remain readable.

## Ralph

Ralph passes its compiled ledger task graph as the authority packet and its executor report as review background. The shared controller reviews the cumulative workspace change under the `balanced` profile. Ralph may still stop its own iteration on Ralph token or time exhaustion; it does not pass a remaining-token ceiling into review. A non-complete shared review terminates the iteration as `review_failed`; only a complete result can reach the closure judge.

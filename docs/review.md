# First-class review

apple-pi's `review` extension turns a Git change into a sealed, coverage-accounted work graph, runs fresh read-only reviewers in parallel, and conservatively verifies their findings. The same controller supplies Ralph's independent review stage.

## Commands

```text
/review                         # run a workspace review
/review preview                 # inspect workspace scope without model calls
/review run workspace
/review run workspace --root ../feature-worktree
/review run range --root repos/service-a --from main --to HEAD
/review run commit --commit abc123
/review run --profile fast
/review run --profile thorough --background "Prioritize migration compatibility."
/review status [run-id]
/review stop <run-id>
```

The `review` tool exposes the same `preview`, `run`, `status`, and `stop` actions. Normal tool and command calls accept semantic source, profile, routing, and background intent only; they never ask a model to estimate token, turn, timeout, group, concurrency, or prompt limits. Its optional `root` selects the Git repository or linked worktree to review; relative paths resolve from the caller's cwd. This is the primary agent workflow, so a model can review a worktree it created or select a repository beneath a non-Git parent directory without moving the parent Pi session. Tool results include the full structured run; the text result is a bounded summary. A completed human `/review run` sends the verified, bounded result back to the current model as a displayed follow-up, so it never interrupts unrelated active work; session replacement or shutdown suppresses that handoff. In the TUI, `/review` argument completion lists actions, source modes, root/profile/routing flags, and known run IDs for status/stop.

Review execution requires a trusted project and an active model. Preview performs only local Git/file inspection.

## Pipeline

1. Resolve the Git repository root and source.
2. Freeze range/commit refs to immutable commits and materialize the resolved head into a temporary read-only review tree, or hash the complete workspace input.
3. Separate reviewable text changes from visible binary waivers.
4. Resolve the planner route, render its complete prompt and typed result-tool contract, and preflight its context envelope.
5. Ask a fresh planner to partition every reviewable item into semantic groups through a controller-supplied typed result tool.
6. Mechanically reject a graph that omits, duplicates, or invents an item.
7. Resolve and preflight each reviewer/verifier's complete rendered context before launch; admitted roles reserve aggregate capacity atomically.
8. Review groups concurrently with fresh read-only agents.
9. Require every reviewer to account for exactly its assigned item IDs.
10. Derive source locations from exact changed-code anchors.
11. Ask fresh verifiers to confirm, reject, or retain every candidate finding.
12. Re-hash the input and freeze complete, partial, failed, skipped, stopped, or conflict state with an explicit cause when incomplete.

The planner groups implementation with tests, producers with consumers, schemas with clients/migrations, and other files that implement one behavior. A focus file belongs to exactly one group. Reviewers may read any repository file for dependency tracing and evidence, but findings must anchor the patch-introduced cause in their assigned focus paths.

No finding count can establish completion. Coverage is the selected denominator and every selected item must finish the full review/verification pipeline. A verifier failure retains candidate findings as unresolved and makes the affected coverage incomplete.

## Profiles and model routing

The semantic planner has its own `review-planner` route, separate from the models that judge code. Profiles control how the planner's requested review tier is interpreted:

- `fast`: every group and verifier uses the fast route.
- `balanced` (default): ordinary groups use fast; the planner can request strong for security, concurrency, lifecycle, compatibility, migration, or dense cross-module work. Significant/critical candidates are verified with strong.
- `thorough`: every group and verifier uses strong.

Routes are ordinary apple-pi modes:

```json
{
  "modes": {
    "review-planner": {
      "provider": "openai-codex",
      "modelId": "gpt-5.3-codex-spark",
      "thinkingLevel": "high"
    },
    "review-fast": {
      "provider": "openai-codex",
      "modelId": "gpt-5.6-luna",
      "thinkingLevel": "xhigh"
    },
    "review-strong": {
      "provider": "openai-codex",
      "modelId": "gpt-5.6-sol",
      "thinkingLevel": "xhigh"
    }
  }
}
```

A trusted project's `.pi/modes.json` wins over global `~/.pi/agent/modes.json`. When a route is absent, the caller's active model is used; this is deliberate model deference rather than a hardcoded provider assumption. `planner_mode`, `fast_mode`, and `strong_mode` can override the mode names per run. The example uses Spark only to classify and group the sealed change; actual review starts with Luna, while high-risk groups and verification escalate to Sol.

The planner recommends only `fast` or `strong`; it cannot choose arbitrary provider/model identifiers or widen its own authority.

## Finding contract

Each finding records:

- severity and category;
- summary, trigger/impact, and evidence;
- focus path and exact source anchor;
- old/new diff side;
- resolved line range when unique;
- anchor provenance and match count;
- independent validation status and evidence.

Exact hunk matching wins. In workspace mode only, a unique current-file match may locate an added/current anchor that overlaps a changed line. Range and commit reviews never consult the unrelated working tree. Duplicate or absent anchors remain `ambiguous` or `unresolved`; the controller never asks a model to invent a line number.

The verifier is asymmetric: it rejects only with concrete counterevidence. Disagreement or inability to reproduce is not enough. Rejected findings stay in the receipt for provenance but are hidden from the normal finding summary.

## Trust, mutation, and persistence

Planner, reviewer, and verifier profiles are packaged as `review-planner`, `reviewer`, and `review-verifier`. They receive only `read`, `grep`, `find`, and `ls`. Extensions and skills are disabled, the role prompt replaces inherited context, nested delegation is disabled, and a call-time path policy blocks reads outside the selected review root or inside `.git`. The controller invokes Git through argument-vector subprocesses; review agents receive no shell.

An explicit review root must resolve to a Git working tree and must either be contained by the current trusted directory/repository, have its Git common directory inside that trusted root, or be a linked worktree of the current repository. Real paths are compared, so a symlink cannot turn a contained-looking root into arbitrary filesystem access. This supports parent directories containing repositories and their external worktrees without granting the model an unrestricted directory selector.

A workspace review does not require a clean checkout or established `HEAD`. Staged, unstaged, untracked, deleted, renamed, executable-mode, symlink, and binary changes are represented. Untracked binary fingerprints include their bytes rather than a generic placeholder. An unborn repository is reviewed as additions. If the selected workspace changes during execution, publication stops with `workspace_conflict`.

Range and commit reviewers never read dependency context from the live checkout. The controller extracts the sealed resolved-head tree to a temporary directory, scopes all read tools to it, and removes it only after every child has quiesced.

A live project lease prevents two Pi processes from reviewing the same project concurrently. A non-owning process may inspect status but cannot claim to stop a live owner's agents; stale leases are reclaimed only after their process is no longer live.

Receipts are append-only JSONL under:

```text
$PI_CODING_AGENT_DIR/reviews/runs/<project-hash>/<run-id>.jsonl
```

They include source identity, work graph, coverage, findings, model routes, usage, role-skill hashes, and child-session paths. They are operational state outside the repository. Persisted child sessions may contain source excerpts and model responses; ordinary Pi session retention and filesystem protections apply.

## Harness-owned limits and outcomes

Profiles select routing and package policy together. After sealing input, the controller derives group/concurrency caps from the change shape. Before every planner, reviewer, and verifier launch it measures the full rendered prompt, packaged role instructions, typed result-tool signature, background/authority context, resolved model context window, output capacity, remaining aggregate capacity, and elapsed time. The receipt records the resolved policy and each stage envelope.

Package-owned ceilings still bound tokens, time, groups, concurrency, prompt bytes, and role turns. They are not normal model or command arguments, and no invalid typed result receives a prose repair retry. A limit never converts incomplete work into success. Terminal receipts and summaries distinguish operator stop, external cancellation, elapsed-time/token/turn ceilings, compaction, provider failure, invalid output, authority denial, workspace conflict, policy/input refusal, and internal error. Existing schema-v1 receipts without these additive fields remain readable as historical audit records.

## Ralph

Ralph passes its compiled ledger task graph as the authority packet and its executor report as review background. The shared controller reviews the cumulative workspace change under the `balanced` profile. A non-complete shared review terminates the iteration as `review_failed`; only a complete result can reach the closure judge.

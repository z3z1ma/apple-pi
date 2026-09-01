---
name: resolving-merge-conflicts
description: "Use when you need to resolve an in-progress git merge/rebase conflict."
---

# Resolving Merge Conflicts

Resolve the current merge or rebase by recovering why both sides exist, not by making conflict markers disappear. Preserve both intents where they are compatible. Where they conflict, follow the confirmed integration goal and report the behavior dropped and the trade-off.

This skill applies only when Git reports an active merge or rebase with unmerged index entries. A cherry-pick, revert, stash apply/pop conflict, or non-conflict interactive-rebase stop has different continuation semantics: stop and report that this skill does not own it. A merge that completed but now misbehaves belongs to `diagnosing-bugs`.

Keep this work root-owned and sequential. It needs no agent fan-out or Pi Exec graph.

## 1. Establish the operation and baseline

Before editing:

1. Inspect `git status`, history, and every unmerged index entry.
2. Identify the exact operation, current `HEAD`, merge side and merge base, or the commit currently being replayed by a rebase. Inspect the remaining rebase plan when it exists.
3. Record the staged, unstaged, and untracked paths already present. Preserve work outside the operation.

Not every conflict has `<<<<<<<` markers. Include modify/delete, add/add, rename, file/directory, binary, symlink, mode, and submodule/gitlink conflicts represented in the unmerged index.

Name commits directly. In a merge, `ours` usually names the current `HEAD` and `theirs` the incoming side. During a rebase those intuitive roles reverse: `ours` is the destination plus commits already replayed, while `theirs` is the stopped original commit. Never choose a resolution from the label alone.

## 2. Find the primary sources

For each conflict, understand why each side changed before resolving it:

- read both commits' messages and diffs;
- follow the repository's documented workflow for operator-supplied pull requests, issues, or specifications;
- inspect authoritative ADRs, documentation, tests, and maintainer instructions governing the area;
- use the current request to confirm the integration goal.

Wiki and ledger material may help locate terminology or intent, but they do not override repository authority, commit evidence, or the operator. If the goal or a material intent remains ambiguous, stop and ask instead of guessing.

## 3. Resolve every unmerged entry

Resolve each entry and hunk by intent:

- Preserve both behaviors when they are compatible.
- When they are incompatible, choose the behavior matching the confirmed integration goal and state what was dropped and why.
- Add only the smallest integration glue needed to make two already-approved behaviors coexist. Explain why it is integration rather than new product behavior.
- Keep unrelated cleanup, redesign, and speculative compatibility work outside the resolution.
- Resolve source manifests or definitions before regenerating lockfiles or derived artifacts through the repository's documented procedure.
- Ask for ownership guidance when a binary, submodule, generated artifact, or other non-text result cannot be established from primary sources.

Bulk `ours`/`theirs`, hard reset, broad restore/checkout, clean, and automatic stash are not resolution methods. They can discard intent or pre-existing work.

## 4. Stage and validate safely

Preserve changes already staged by Git's merge or rebase sequencer. Add or remove only paths whose resolution you inspected; never use blanket `git add -A`.

Before continuation:

1. Verify that no unmerged index entry remains.
2. Inspect every staged path, deletion, and cached diff.
3. Run `git diff --cached --check` or the repository's equivalent residual-conflict check.
4. Discover the repository's automated checks. Run the cheapest meaningful checks at each rebase stop and the full relevant gate after the final continuation.
5. Fix only failures caused by the resolution and covered by the request. Report unrelated or pre-existing failures instead of expanding scope.

If the cached index contains a path that is neither sequencer-owned nor an inspected resolution, stop. The operator must decide whether it belongs in the result or how its prior state should be preserved. Do not silently commit, unstage, stash, reset, or discard it.

## 5. Finish only the authorized operation

A request to resolve conflicts authorizes path-scoped edits and selective staging of the conflicted paths. Loading this skill, including implicit model invocation, is not authority to create or rewrite commits.

Explicit operator language to finish or continue the current operation authorizes its ordinary operation-specific completion: `merge --continue` for a merge or repeated ordinary `rebase --continue` steps for that rebase. Do not substitute a normal commit for the rebase sequencer. If a rebase stops on another conflict, repeat this entire evidence and resolution loop before continuing.

Pause before:

- non-pick rebase commands or additional-ref updates;
- deciding whether to skip or keep a commit;
- amending or creating a commit outside ordinary continuation;
- continuing with an unexpected staged path;
- any material ambiguity about intent or destructive effect.

After continuation, confirm that the operation ended or identify the next stop, inspect the resulting history and topology, compare status with the initial baseline, and run the final relevant checks. The correct result may retain pre-existing unrelated work; do not claim a clean tree when it is not clean.

Abort is an operator-only cancellation action, never an escape from a difficult resolution. Before an authorized abort, explain the resolution and replay work it will discard and any autostash risk. Rebase skip is also operator-only and requires explicit confirmation that the stopped commit should be dropped.

Finishing a local merge or rebase never authorizes pushing it.

## Report

Report the operation and commits resolved, primary sources used, conflict decisions and trade-offs, checks actually run, final operation state, and any preserved unrelated work or unresolved uncertainty. Record that evidence in an existing governing ledger task only when it has real resume, handoff, or audit value; create no conflict-resolution artifact for ceremony.

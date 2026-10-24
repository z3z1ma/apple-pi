---
name: resolving-merge-conflicts
description: "Use when you need to resolve an in-progress git merge/rebase conflict."
---

# Resolving Merge Conflicts

Resolve the current merge or rebase by recovering why each side exists, not by making markers disappear. Keep both intents where they are compatible; where they conflict, follow the confirmed integration goal and report what was dropped and why.

This skill covers an active merge or rebase with unmerged index entries. A cherry-pick, revert, or stash conflict, or a non-conflict rebase stop, has different continuation rules: report that this skill does not own it. A completed merge that misbehaves belongs to `diagnosing-bugs`. Resolve alone, one entry at a time: one writer in the index.

## 1. Establish the baseline

Inspect `git status`, the operation, `HEAD`, the merge side and base (or the commit being replayed and the remaining rebase plan), and every unmerged entry, including modify/delete, rename, binary, mode, and submodule conflicts without markers. Record the paths already staged, unstaged, or untracked, and preserve them.

Name commits, never labels: in a rebase, `ours` is the destination plus the commits already replayed and `theirs` the commit being replayed, the reverse of a merge.

## 2. Find each side's intent

Read both sides' commit messages and diffs, the documentation, ADRs, and tests that govern the area, and the operator's goal for this integration. When a side was written by a person in the organization who is still in the directory, mail them for that side's intent; their answer joins the commits as evidence, it does not overrule them. Ask the operator when the goal or a material intent stays unclear.

## 3. Resolve every entry

- Keep both behaviors when they are compatible.
- When they are not, choose the one the integration goal asks for and record what was dropped.
- Add only the glue needed for two approved behaviors to coexist; leave cleanup and redesign out.
- Resolve source manifests before regenerating lockfiles or other derived files by the repository's procedure.
- Ask for ownership guidance on a binary, submodule, or generated result the sources cannot settle.

Resolve by intent, entry by entry. Bulk `ours`/`theirs`, hard reset, broad checkout or restore, clean, and automatic stash discard intent or other work; they are not resolution methods.

## 4. Stage and check

Stage only paths whose resolution you inspected, by name (never `git add -A`, which sweeps in unrelated work), and keep what the sequencer staged. Before continuing: no unmerged entry remains, every staged path and deletion is inspected, `git diff --cached --check` is clean, and the repository's cheapest meaningful checks pass (the full relevant gate after the final continuation). Fix only failures the resolution caused. If the index holds a path that is neither sequencer-owned nor an inspected resolution, stop and ask the operator; leave it as it is rather than committing, unstaging, stashing, or resetting it.

## 5. Finish only what was authorized

A request to resolve conflicts authorizes editing and staging the conflicted paths, and loading this skill authorizes no commit. Continuing (`merge --continue`, `rebase --continue`) needs the operator's word to finish the operation; finish a rebase through the sequencer, never with a plain commit, and repeat this loop at each new stop. Ask before a non-pick rebase command or a ref update, skipping, amending, or creating a commit outside continuation, continuing with an unexpected staged path, and anything else whose intent or destructive effect is unclear. Abort and skip are the operator's decisions: before an abort, say what resolution and replay work it discards; before a skip, confirm the stopped commit is meant to be dropped. Finishing locally never authorizes a push.

After continuing, confirm the operation ended or find the next stop, inspect the resulting history, compare status with the baseline, and run the final checks; say so plainly when the tree is not clean.

Report the operation and commits, the sources and authors consulted, each decision and trade-off, the checks run, the final state, and any preserved unrelated work.

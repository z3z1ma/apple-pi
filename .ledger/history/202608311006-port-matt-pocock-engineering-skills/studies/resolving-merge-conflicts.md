# Resolving merge conflicts

Source: `mattpocock/skills` at `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`

Status: approved; implementation and validation complete

## Target

Preserve upstream as a standalone, model-invoked discipline for an already in-progress Git merge or rebase: establish the exact operation and both sides' intent, resolve every unmerged entry from primary sources rather than text preference, validate the integrated behavior, and complete only the effects the operator authorized.

## Upstream doctrine to preserve

- Start only after Git has stopped an in-progress merge or rebase on conflicts.
- Inspect operation state, history, and every conflicting file before mutation.
- Trace each side to primary sources: commits and diffs first, then authoritative pull requests, issues, specifications, and repository decisions when available.
- Resolve by intent, not by `ours`/`theirs` preference or by deleting conflict markers until the tree compiles.
- Preserve both intents when compatible. When they are incompatible, follow the confirmed integration goal and state the dropped behavior and trade-off.
- Add no unrelated product behavior to disguise an unresolved clash.
- Discover and run the repository's own automated checks before completion; a syntactically resolved tree is not proof of a correct integration.
- For a multi-commit rebase, repeat the evidence and resolution loop for each new conflict rather than assuming the first decision applies globally.
- Hand a post-resolution behavioral failure with no visible conflict cause to `diagnosing-bugs`; this skill remains outside the ordinary idea-to-ship flow.

## Concrete hazards in the literal upstream procedure

1. `Always resolve; never --abort` assumes the integration decision is irrevocable before invocation. It has no safe branch when the operation is based on the wrong commits, primary intent is unavailable, continuation risks data loss, or the operator changes direction.
2. `Stage everything and commit` can capture unrelated working-tree or untracked changes and creates or rewrites commits without Apple Pi's required operator authority.
3. A rebase reverses the intuitive meaning of `ours` and `theirs`: the checked-out side is the rebased destination and the other side is the commit being replayed. Flag names are unsafe substitutes for resolved commit identities.
4. Not every Git conflict has conflict markers or even text hunks. Modify/delete, rename, add/add, file-type or mode, binary, submodule, and directory/file conflicts still require an explicit intent decision.
5. `Fix anything the merge broke` can turn conflict resolution into unrelated cleanup unless failures are traced to the resolution or current operation.
6. A final clean tree is not a valid invariant when unrelated pre-existing work must be preserved. The invariant is: no unresolved index entries, the authorized operation state is complete, and preserved work is reported accurately.
7. `git rebase --continue` rewrites history and may advance through several commits or execute non-pick todo commands. `git merge --continue` creates the merge commit. Neither is merely a marker-resolution operation, and an ordinary `git commit` is not a safe substitute for the rebase sequencer.
8. Full-suite validation before every rewritten commit may be impossible when an intermediate replayed commit intentionally depends on a later commit. Each stop needs the cheapest meaningful checks; the complete relevant gate belongs after the final continuation.

## Proposed Apple Pi translations

- Keep mutation root-owned and sequential. This thin discipline needs no team fan-out, Pi Exec graph, new runtime, or supporting reference file.
- Begin with `git status`, the unresolved-index entries, the operation type, branch/commit identities, the merge base or current replayed commit, and a snapshot of pre-existing staged, unstaged, and untracked work. Preserve work outside the operation.
- Support only an active merge or active rebase that has unmerged index entries. Fail closed rather than borrowing the wrong continuation semantics for cherry-pick, revert, stash apply/pop, or a non-conflict interactive-rebase edit stop.
- Name commits and intent sources directly. Treat `.wiki/` and `.ledger/` as supporting context that may locate terminology or intent but cannot override repository history, authoritative specifications/ADRs, or the operator.
- Cover every unmerged index entry, including conflicts without markers. Resolve source files before regenerating derived or lock files through the repository's documented procedure; ask for ownership guidance on unsupported binary, submodule, or other non-text results.
- Allow only the smallest integration glue needed to make two already-intended behaviors coexist; explain why it is integration rather than new product behavior.
- Preserve sequencer-owned staged changes and stage only inspected, resolved paths. Never use blanket `git add -A`, bulk `ours`/`theirs`, hard reset, clean, automatic stash, skip, or abort as shortcuts.
- Discover checks from repository authority. Run the cheapest meaningful checks at each stop and the full relevant gate after the operation completes. Correct failures caused by the resolution; report unrelated or pre-existing failures instead of expanding scope.
- Before any authorized continuation, verify that no unmerged index entries remain, inspect every staged path, deletion, and cached diff, run the applicable checks, and report the intent sources and trade-offs. Inspect a rebase plan for non-pick commands before continuation.
- If the cached index contains a path that is neither sequencer-owned nor an inspected resolution, stop before continuation. The operator must explicitly decide whether that path belongs in the result or how its prior state should be preserved; the skill never silently commits, unstages, stashes, resets, or discards it.
- Use the operation-specific continuation command after authority is established. Continuing a rebase repeats the evidence and resolution loop if Git stops again; it never implies permission to push.
- After continuation, confirm that the operation ended or identify the next stop, inspect the resulting topology, compare status with the initial baseline, and run the final relevant checks before claiming completion.
- A request to resolve conflicts authorizes edits and selective staging of the conflicted paths. Merge commits, rebase continuation/history rewriting, skipping a commit, aborting the operation, pushing, and other external effects require explicit operator authority.
- Persist sources and trade-offs in an existing governing ledger task only when they have handoff or audit value. Create no conflict-resolution artifact schema.

## Deviation classification

| Change | Classification | Reason |
| --- | --- | --- |
| Remove upstream web links and `ask-matt` placement language | Platform/package translation | Apple Pi has no router skill and the packaged skill must stand alone. |
| Root-owned sequential execution and optional ledger/wiki context | Platform translation | Maps to Apple Pi's execution and storage boundaries without changing the conflict method. |
| Explicit completion/commit authority | Policy proposal | Upstream automatically commits or rewrites history; Apple Pi reserves those effects for the operator. |
| Replace absolute `never --abort` with a stop-and-ask path | Policy proposal | Preserves work and operator control when the integration premise changes or cannot be established. |
| Cover non-marker conflicts, rebase role reversal, and unsupported operation states | Deliberate safety addition | Prevents concrete silent-loss and wrong-sequencer failures left implicit by the short source. |
| Selective staging, operation-specific continuation, and preservation of unrelated work | Deliberate safety addition | Prevents unrelated changes entering the result or malformed rebase history. |
| Minimal integration glue | Policy clarification | Reconciles preserving both intents with the source's ban on inventing behavior. |

## Operator decisions

1. Preserve upstream's end-to-end completion goal behind Apple Pi's authority boundary. Loading or implicit invocation of the skill is not commit authority. A request to resolve conflicts authorizes path-scoped edits and selective staging; explicit language to finish or continue the current merge/rebase authorizes the operation-specific merge commit or ordinary repeated rebase continuations. Pause for non-pick todo commands, skip/keep judgments, amends, new commits, additional-ref updates, unexpected staged paths, or material ambiguity. Push remains separately authorized.
2. Abort and skip are operator-only recovery actions, never shortcuts. Abort requires an explicit cancellation request plus a warning about discarded work; skip requires explicit confirmation that the stopped commit should be dropped.
3. Minimal justified integration glue is allowed when it is necessary to make two already-approved behaviors coexist. It must be the smallest such change and must be explained as integration rather than new product behavior.

## Validation

- One concise model-invoked `SKILL.md` preserves upstream's intent-first loop without adding a runtime, graph, reference file, or ledger schema.
- Focused contract checks cover the exact trigger, supported operation states, primary-source decisions, rebase side inversion, non-marker conflicts, minimal integration glue, cached-index ownership, selective staging, continuation authority, operator-only abort/skip, validation, and publication boundaries.
- The real loader discovers `resolving-merge-conflicts` with model invocation enabled and no diagnostics.
- The package dry run includes `skills/resolving-merge-conflicts/SKILL.md`.
- Validation passed the 86-test focused skill/runtime selection, the 905-test unit suite, typecheck, loader validation, formatting, focused lint, package inclusion, and scoped diff checks. A repository-wide `git diff --check` also reported one unrelated pre-existing blank line at the end of `.ledger/INDEX.md`; the resolving-merge-conflicts scope is clean.

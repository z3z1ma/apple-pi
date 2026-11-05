Status: in-progress
Created: 2026-11-04
Updated: 2026-11-04

# Workplace Git tab: a GitKraken-like first-class tab

## Intent

Operator, 2026-11-04: split the Git view out of the Code tab into its own first-class Workplace tab, "very similar to a slimmed-down version of GitKraken": visually appealing, complete Git management across any repository or worktree, easy commit, branch, pull, push, fetch and the rest, all over the machine's own `git`. The Code tab keeps no Git view. The code review tab is the next tab to break out. The rail will no longer fit every tab, so it needs an overflow ("more") affordance; its form was left to us.

## Shape

- **Tab:** `Git` in the rail after Code, with its own URL view (`?workplace=git`). Code loses its Git pane, Git toggle and diff view.
- **Layout (GitKraken-like):** top toolbar (repository and worktree pickers, current branch, Fetch, Pull, Push with ahead/behind, Branch, Stash, Pop, Refresh); left panel (local branches with ahead/behind, remotes, tags, stashes, worktrees); centre commit graph with coloured lanes, ref badges, message, author, date, short SHA, and a "working changes" row; right panel for working changes (stage, unstage, discard, commit message, amend, commit) or the selected commit (details and changed files); a diff view for any file.
- **Operations:** stage, unstage, discard, commit (amend), checkout, create/delete/merge branch, fetch, pull, push (setting upstream), stash save/apply/pop/drop, cherry-pick, revert, reset (soft/mixed/hard), create/delete tag. Destructive ones confirm first.
- **Backend:** a `git` API beside `workspace`, argument arrays only, same Git hygiene as the workspace backend; `gitStatus`/`gitDiff` move out of the workspace API.
- **Rail overflow:** the rail shows the apps that fit its height; the rest go under a "More" button that opens a menu.

## Acceptance

- The Git tab performs every operation above against a real repository (backend tests over real temporary repositories with a bare remote), with confirmations for destructive actions.
- The UI renders the graph, branches, working changes and diffs, and drives the operations (headless-Chrome tests against a fixture backend, screenshots light and dark).
- The Code tab has no Git view; existing Code tests still pass.
- The rail overflows gracefully at small heights.
- Typecheck, lint, the Workplace build (committed `dist/`) and focused tests pass; the real app is relaunched with the operator's consent and checked through its real entry path.

## Current State

Built and committed on main; awaiting the live relaunch with the operator's consent.

- Backend `src/backend/git.ts` over the shared `git()`; typed API and IPC guards in `src/git.ts`; `git:*` IPC and preload. The workspace API lost `gitStatus`/`gitDiff`.
- UI `web/workplace-git.tsx` (graph, sidebar, working changes, commit form, commit detail), `workplace-git-graph.ts` (lanes), `workplace-git-diff.tsx` (numbered diff). Code has no Git pane. The rail's `RailApps` moves apps that do not fit under More.
- Checks run: `git-backend.test.ts` 11/11 (all 24 action kinds against real temporary repositories with a bare remote, including conflicted merge and rebase continued and aborted); `world-git.test.ts` 5/5 with light and dark screenshots looked at; `world-code`, `world-terminal`, `world-file-links`, `world-navigation`, `workspace-backend`, `build` pass; typecheck, Biome on changed files, context lint pass; the isolated real-Electron check (`scripts/workplace-electron-check.mjs`, whose stale runtime path was fixed) passes, including `git.overview` through the real preload.
- Not verified: the operator's real app; SSH or HTTPS credential behaviour on a real remote (tests use a local bare remote); very large histories beyond one 300-commit page per load.

## Outcome

Pending.

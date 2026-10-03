# Session log analysis

How to measure agent behavior from Pi session logs, and the traps that make such numbers mislead. Earlier uses:

- the learning-loop evidence in `.ledger/202610022036-notebook-learning-loop/`;
- a count of runs whose final "tests pass" claim had no later run behind it, which informed [[epistemic-grounding]];
- prompt-cache audits with `scripts/cache-audit.mjs`.

## Layout

Session files are JSONL under `~/.pi/agent/sessions/<project>/*.jsonl`. Each `<project>` directory is the working directory with `/` replaced by `-`, wrapped in `--`, for example `--Users-alex-code-app--`. Because the names start with `--`, pass `--` before globs to `ls`.

Each line is one entry with a `type`:

- `message` entries carry `message.role`: `user`, `assistant`, `toolResult`, `system`, or `custom`.
- Tool calls live inside the assistant message's `content` as items with `type: "toolCall"`, `id`, `name`, and `arguments`.
- A `toolResult` message points back with `toolCallId` and carries `toolName` and `isError`.
- `custom` entries hold extension state, for example `notebook.*` records.
- Assistant messages carry `usage` (input, cacheRead, cacheWrite, output).

Entries form a tree through `id` and `parentId`: tree navigation and branching append a new branch to the same file. Reading lines in file order, as `scripts/cache-audit.mjs` and the studies above do, mixes abandoned branches into the result. To follow one branch, walk `parentId` back from its leaf entry.

A practical unit is the **run**: the steps between one `user` message and the next on the same branch. Extension continuations such as change reflection stay inside the run. In file order this is an approximation that holds only for sessions without branches.

## Traps

- **Mixed populations.** The sessions directory holds root sessions, persisted child sessions, and temporary test or review sessions under `--private-tmp-…`. Filter or report the mix.
- **Checks hide in other tools.** Classifying verification by command regex has low precision: real checks run inside `pi_exec` code, `agent` children, `.venv` binaries, or repository scripts.
- **Classification-free proxies still mislead.** "Did any command run after the last edit" counts `ls` and `git status` as verification and misses checks done by an `agent` child. The error runs both ways.
- **A background launch is not a completed run.** `run_in_background` returns at launch; the outcome arrives later as a task notification, not as that tool result.
- **Claims are text.** Regex on final assistant text for "tests pass" finds narration and plans as well as claims; sample matches by hand before trusting a rate.

## Reporting rule

Label each number by what was actually counted ("runs with no successful `bash` or `pi_exec` after the last code edit"), not by the concept it stands for ("unverified runs"). Sample a handful of matches by hand and report the precision you saw.

## Sources

- Analyses run on 2026-10-02 and 2026-10-03 over the last 30 days of local sessions; corrections from the pair during the [[epistemic-grounding]] work.

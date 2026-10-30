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

For older transcript-only studies, steps between consecutive `user` messages on one branch are a convenient **analysis segment**, not a reliable runtime-run boundary. Custom messages can initiate work or join active work, and queued input can continue an existing run. Label this segmentation as an approximation even when there are no branches.

## Runtime run boundaries

A high-level run is one response to an initiating input through final settlement, including queued continuations. Pi's `agent_start` names a lower-level loop and can repeat on `agent.continue()` within that run. The initiating-input hook is `before_agent_start`; final settlement is `agent_settled`. Preparation is distinct from actual execution. Missing boundaries and observation gaps remain unknown rather than being joined by nearby timestamps.

This boundary was checked in installed Pi 1.4.0 and published 1.2.0 source during the introspection audit, not established by a new executed lifecycle test. The bridge's context file holds the exact host-field and instrumentation hazard. Existing command-delivery or transcript-persistence timestamps alone cannot recover historical run origins.

## Incoming-mail time attribution

A message arriving late in a run cannot make the earlier interval mail-associated. Preserve the pre-receipt prefix and separate the mixed tail after the first actual consumed mail. Mail-initiated runs form a separate category. Clip all intervals to the selected observation window, union overlaps per emitting session, and display unknown association and unobserved gaps separately. Inputs after the cutoff cannot reclassify the earlier report; retained context mail is not another receipt on each run.

A synthetic 20-minute window illustrates the denominator:

| Emitting session | Before typed mail | Mail-initiated or mixed tail | Observed, association unknown | Unobserved gap |
| --- | --- | --- | --- | --- |
| A | 8 min | 12 min | 0 | 0 |
| B | 0 | 10 min | 0 | 0 |
| C | 0 | 0 | 14 min | 6 min |

The denominator is 44 observed session-minutes, with 22 incoming-mail-associated minutes and 6 additional unobserved minutes. Parallel sessions explain why this exceeds 20 wall-clock minutes. The 22/44 share is not a wasted-chatting percentage: the tail can implement the incoming request, and a pre-mail interval can contain outgoing composition or pull reads. Parent waiting and delegated-peer execution also overlap; keep emitting identity and caller accounting separate rather than present their sum as task duration.

These are measurement constraints from the approved introspection plan, not a claim that the proposed observations are already available or that communication caused delay. Use a concrete timeline and a named denominator before interpreting an activity ratio.

## Diagnosing a stalled handoff

An earlier readiness reply, an idle directory status and delivered coordination mail do not establish that a person's next turn ran. At a blocking handoff, look for fresh acknowledgment or actual activity such as the expected check process or new output. A provider failure can leave work assigned while execution never begins.

For authorized local diagnostics of a known session, inspect the runtime database query-only. The `sessions.last_error` field supplies recorded failure evidence that the compact directory profile omits; correlate it with fresh activity rather than treating an old error as proof of current unavailability. `sessions.session_file` gives the recorded transcript path, avoiding guesses about the encoded project directory. Preserve unavailable/null evidence explicitly and keep private transcript contents out of shared reports. Reassign blocked execution while preserving saved implementation rather than leaving a shared verification slot reserved indefinitely.

Source: session learning `2a6ea7faf4c1`, from a communication-verification handoff that stalled after an earlier successful acknowledgment; field ownership is in `components/session-state/src/schema.ts` and `components/session-state/src/runtime.ts`. This is a diagnostic lesson, not a new directory or access contract.

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
- High-level run boundaries: 2026-10-30 source audit `work-1f93c772-0c1d-4529-be2a-b07c68be3096/findings.md`, "Exact execution-origin boundary," and session learning `b172ac1365e8`; installed Pi 1.4.0 and published 1.2.0 source, not fresh runtime proof.
- Time attribution and synthetic timeline: approved `work-6b970011-dde3-4b35-aae2-9e9c8c80f813/proposal.md`, "Record high-level runs and actual message consumption," and session learning `cfcdc0860fde`. Task artifacts remain in their task bundles; no private transcript material is reproduced here.

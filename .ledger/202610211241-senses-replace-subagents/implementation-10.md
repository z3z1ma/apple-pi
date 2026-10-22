# Ticket 10 implementation notes

The approved interface is in [the specification](spec.md#pi_exec-on-peers) and [ticket 10](tickets/10-pi-exec-on-peers.md). This is the implementation sequence, not a new approval gate.

## One turn mechanism

Use the session-state bridge for both attached sessions and new peers. A correlated run command waits for the recipient to be idle, appends the program's goal, and returns the final settled reply through the command connection. Results are not mail. A schema activates the existing structured-return tool for that run only. Progress, usage, tool observations, and edit/write changes belong to that correlated run. Cancellation addresses that run, not arbitrary work already running in an attached session.

The bridge queues program runs and starts them outside notification-only settlement handlers. A session replacement or lost bridge fails affected requests rather than attributing another session's reply to them.

## First slice: implemented

`peer-turns.ts` and the bridge/runtime protocol now share a correlated turn mechanism. Seven real-faux-session tests cover final reply and transcript ownership, slash-led goals, busy waiting, repeated structured calls (including a real tool-result hook), invalid typed replies, queued and active cancellation, and runtime outage without aborting unrelated work. The shared observer also serves the existing one-shot runner, preserving its process cleanup while removing the duplicate event decoder.

Progress snapshots coalesce under backpressure. Final results travel only in their waiting receipt; the transcript stays the durable owner. Runtime restart fails unfinished turn commands instead of leaving them recorded as pending.

Checks: 113 tests passed across eight focused files (`/tmp/apc10-core-tests.log`), Node and web typecheck passed, and context lint passed (119 files). The strengthened post-hook peer test then passed with the other six peer-turn tests (`/tmp/apc10-hook-test.log`). The public Python API and ephemeral ownership are still pending.

## Execution ownership

One program-scoped connection owns its ephemeral peers. Runtime-owned metadata distinguishes them from lasting people; attached people never acquire that ownership. Launch uses the existing tmux start path, or a headless RPC process when there is no caller pane. Both then use the same bridge turn command. Native SIGTERM preserves Pi's detached-tool cleanup.

Discard waits for owned processes to end, then removes their person records, assignments, thread memberships, and owned ephemeral task bundles, while keeping Pi transcript files. Closing the program connection also cleans up. Persisted ownership lets runtime restart find abandoned ephemeral work. A lasting person or shared/promoted task is not disposable merely because it was related to a temporary person. Ephemeral people do not send routine close mail to the caller; their result is the return value.

## Monty handles

A probe against the installed Monty confirmed plain Python classes with async methods survive dump/load and dispatch through the current feed's host functions. Use a small Python `Peer` facade holding a per-execution id, with calls through the existing budgeted host bridge. Host `ClassInstance` wrappers are unsuitable here: Monty's instance store holds them for the entire interpreter lifetime. The probe also found that a leading-underscore external function in type stubs is unresolved in a method; use ordinary helper names.

Handles belong to one invocation. A later invocation attaches again; an old handle cannot reopen a discarded peer or retain an old tool context. `agent` and the existing status-returning `agent_run` use catalog roles, not type/profile/tool/system-prompt overrides. Preserve bound context and its fitting metadata for the review programs; put that context beside the assigned goal rather than granting another prompt-authority path.

## Proof sequence

1. Real faux sessions over a temporary runtime: attached turn, busy wait, typed result, scoped cancellation, no attached close.
2. Isolated process/tmux fixtures: role and goal at launch, headless RPC, ten sequential calls, explicit handle reuse and close, cancellation/error/disconnect cleanup, transcript retained and person removed.
3. Real Monty programs over the host bridge: named attachments, stale-handle refusal, budget/trace/usage preservation, and cleanup after every outcome.
4. Rewrite review/Ralph examples to catalog roles; run their focused contract checks, typecheck, loader and packaging checks. The single full repository suite remains for the end of the undertaking.

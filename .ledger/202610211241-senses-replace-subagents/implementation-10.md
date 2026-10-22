# Ticket 10 implementation notes

The approved interface is in [the specification](spec.md#pi_exec-on-peers) and [ticket 10](tickets/10-pi-exec-on-peers.md). This is the implementation sequence, not a new approval gate.

## One turn mechanism

Use the session-state bridge for both attached sessions and new peers. A correlated run command waits for the recipient to be idle, appends the program's goal, and returns the final settled reply through the command connection. Results are not mail. A schema activates the existing structured-return tool for that run only. Progress, usage, tool observations, and edit/write changes belong to that correlated run. Cancellation addresses that run, not arbitrary work already running in an attached session.

The bridge queues program runs and starts them outside notification-only settlement handlers. A session replacement or lost bridge fails affected requests rather than attributing another session's reply to them.

## First slice: implemented

`peer-turns.ts` and the bridge/runtime protocol now share a correlated turn mechanism. Seven real-faux-session tests cover final reply and transcript ownership, slash-led goals, busy waiting, repeated structured calls (including a real tool-result hook), invalid typed replies, queued and active cancellation, and runtime outage without aborting unrelated work. The shared observer also serves the existing one-shot runner, preserving its process cleanup while removing the duplicate event decoder.

Progress snapshots coalesce under backpressure. Final results travel only in their waiting receipt; the transcript stays the durable owner. Runtime restart fails unfinished turn commands instead of leaving them recorded as pending.

Checks: 113 tests passed across eight focused files (`/tmp/apc10-core-tests.log`), Node and web typecheck passed, and context lint passed (119 files). The strengthened post-hook peer test then passed with the other six peer-turn tests (`/tmp/apc10-hook-test.log`). At that checkpoint, the public Python API and ephemeral ownership were still pending.

## Execution ownership

One program-scoped connection owns its ephemeral peers. Runtime-owned metadata distinguishes them from lasting people; attached people never acquire that ownership. Launch uses the existing tmux start path, or a headless RPC process when there is no caller pane. Both then use the same bridge turn command. Native SIGTERM preserves Pi's detached-tool cleanup.

Discard waits for owned processes to end, then removes their person records, assignments, thread memberships, and owned ephemeral task bundles, while keeping Pi transcript files. Closing the program connection also cleans up. Persisted ownership lets runtime restart find abandoned ephemeral work. A lasting person or shared/promoted task is not disposable merely because it was related to a temporary person. Ephemeral people do not send routine close mail to the caller; their result is the return value.

## Second slice: process ownership implemented

The runtime now owns program scopes and their temporary people from before process creation through cleanup. The caller uses one scoped connection. Headless launches use ordinary RPC sessions and bridge commands, while tmux launches use the caller's server. Closing stops this program's requested turns without closing attached people, waits for temporary processes, removes owned tasks and person records, and preserves transcripts, lasting people, and shared or promoted work. Creation ancestry survives reporting transfers; nested scopes remain visible until their resources are gone. An old daemon produces a restart instruction rather than an unanswered protocol request.

The ten lifecycle tests cover headless role/goal delivery, graceful termination, attached-person survival and request cancellation, nested cleanup after a transfer, failed startup, shared and promoted tasks, pre-hello cancellation, daemon-crash recovery, ten tmux iterations, and a renamed window at the pre-hello crash boundary. The last test first failed: window-name-only recovery said cleanup had finished while the process was still running. Recovery now uses the immutable initial command as well. RPC also ignores positional CLI prompts, so ordinary headless hires receive their startup instruction through the bridge; program peers receive only their correlated run.

Checks: 68 tests passed across ten focused files (`/tmp/apc10-ownership-tests-final.log`); Node and web typecheck passed (`/tmp/apc10-ownership-types-final.log`). The renamed-window test has a recorded red/green pair (`/tmp/apc10-window-recovery-red.log`, `/tmp/apc10-window-recovery-green.log`). All processes, tmux servers, and state directories used in these checks were isolated from the operator's sessions.

## Third slice: public integration

The Python API now uses these peers. Named attachments and ID-only `Peer` objects run through the existing host-call trace and budget bridge; `agent` and `agent_run` create and discard a catalog-role person per call. Handle reuse, explicit close, stale-handle rejection after checkpoint restore, context fitting, large bound values, private context files, partial usage on cancellation, and cleanup on failure are exercised through the real registered tool and an isolated runtime. The ten-window test now uses the same one-shot call implementation as Python, rather than manually discarding each person.

Model-facing requests identify the waiting program and direct-reply convention. RPC roots get human names; temporary peers skip routine completion notifications and bells, while operator questions still notify. Review programs use Code Review Specialists, Principal Engineers for planning, and Scientific Skeptics for final verification. Ralph uses a new Implementation Engineer per iteration. Procedure text is part of the assigned goal, not a role or model override.

A focused control test exposed a deadlock: with one concurrency slot, a running turn held the slot needed by its own `close()`. Close is now a control request outside the work semaphore, still charged to call budget. The test failed with a timeout before the change and passed afterwards (`/tmp/apc10-close-slot-red.log`, `/tmp/apc10-close-slot-green.log`). Cleanup is awaited before the final trace and usage snapshot, including effects that finish during cancellation.

Checkpoint compatibility now includes the Python prelude as well as stubs; dumps retain class implementations, so signature-only compatibility would preserve an obsolete handle method. The public interface has no per-call type, profile, tool-list, pairing, or system-prompt override.

Final focused validation passed 196 tests across 16 files (`/tmp/apc10-final-focused.log`). The strengthened API suite then passed all 12 tests, with attached and temporary cancellation retaining usage and checking real process survival/death (`/tmp/apc10-cancel-final.log`). Node and web typecheck, loader, format check, lint (one existing warning), context lint (126 files), and package dry run passed. The package includes both new peer modules and the five migrated Python references. No paid model call was used, and no live operator runtime or session has been restarted.

## Monty handles

A probe against the installed Monty confirmed plain Python classes with async methods survive dump/load and dispatch through the current feed's host functions. Use a small Python `Peer` facade holding a per-execution id, with calls through the existing budgeted host bridge. Host `ClassInstance` wrappers are unsuitable here: Monty's instance store holds them for the entire interpreter lifetime. The probe also found that a leading-underscore external function in type stubs is unresolved in a method; use ordinary helper names.

Handles belong to one invocation. A later invocation attaches again; an old handle cannot reopen a discarded peer or retain an old tool context. `agent` and the existing status-returning `agent_run` use catalog roles, not type/profile/tool/system-prompt overrides. Preserve bound context and its fitting metadata for the review programs; put that context beside the assigned goal rather than granting another prompt-authority path.

## Proof sequence

1. Real faux sessions over a temporary runtime: attached turn, busy wait, typed result, scoped cancellation, no attached close.
2. Isolated process/tmux fixtures: role and goal at launch, headless RPC, ten sequential calls, explicit handle reuse and close, cancellation/error/disconnect cleanup, transcript retained and person removed.
3. Real Monty programs over the host bridge: named attachments, stale-handle refusal, budget/trace/usage preservation, and cleanup after every outcome.
4. Rewrite review/Ralph examples to catalog roles; run their focused contract checks, typecheck, loader and packaging checks. The single full repository suite remains for the end of the undertaking.

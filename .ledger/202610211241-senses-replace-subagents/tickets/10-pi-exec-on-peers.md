# 10: `pi_exec` on peers

**Context:** [spec.md](../spec.md) defines the terms used here (person, operator, runtime, thread, push and pull, ephemeral task, intern) and records the decisions this ticket implements.

**What to build:** A `pi_exec` call can attach existing peers as named handles (`run(task, output_schema?)`), run as one turn in each peer's session, waiting while it is busy, never closing it. `agent(role, task, output_schema?)` with no attached peer starts an ephemeral peer in that catalog role, reporting to the caller, with an ephemeral task holding its prompt; runs one turn; returns the final reply (or the validated typed value); and closes it. `peer(role)` returns a handle for several runs and `close()`. Every ephemeral peer still open is discarded when the execution ends, fails, or is cancelled. Discarding closes the peer and deletes its session record, assignments, and thread memberships; the transcript file stays. Ephemeral peers open a tmux window in the caller's server, or run headless (RPC mode) when the caller is not in tmux. The `type` and `profile` arguments are removed; the review and Ralph programs and skills use catalog roles.

**Blocked by:** 02 The directory and human-named manager tools, 06 Tasks are assigned

**Status:** done

- [x] With an attached peer, `peers["x"].run(task)` returns that turn's final text, the turn is in the peer's transcript, and the peer is still running afterwards.
- [x] A run on a busy attached peer starts only after its own run settles.
- [x] A loop of ten `agent(role=..., task=...)` calls never has more than one ephemeral window open, and leaves no ephemeral session record.
- [x] An `output_schema` call returns a value that matches the schema; a reply that does not match fails the call.
- [x] A cancelled program leaves no ephemeral peer running and no record behind.
- [x] Outside tmux, `agent()` runs headless and still returns.
- [x] The review and Ralph reference programs run with roles (no `builder`, no `type`).

**Evidence:** [Implementation notes](../implementation-10.md) record the three slices and their proof. The final focused run passed 196 tests across 16 files; the strengthened API suite then passed all 12 tests, including cancellation of both attached and temporary people with actual process-lifetime assertions. Node/web typecheck, loader, format check, lint, context lint (126 files), and package dry run passed. Lint retains one existing warning. Fixtures used isolated runtimes and tmux servers; no paid model turn or live-session rollout was performed.

**Deviations:** Kept the existing `agent_run` status form and bound-context fitting for real review/Ralph consumers. Per-call inference, posture, and system-prompt overrides are removed. Peer close bypasses work concurrency but still consumes call budget, preventing cancellation from waiting behind the turn it must stop. Cleanup completes before the final result; failures remain visible.

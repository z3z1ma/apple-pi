# 10: `pi_exec` on peers

**Context:** [spec.md](../spec.md) defines the terms used here (person, operator, runtime, thread, push and pull, ephemeral task, intern) and records the decisions this ticket implements.

**What to build:** A `pi_exec` call can attach existing peers as named handles (`run(task, output_schema?)`), run as one turn in each peer's session, waiting while it is busy, never closing it. `agent(role, task, output_schema?)` with no attached peer starts an ephemeral peer in that catalog role, reporting to the caller, with an ephemeral task holding its prompt; runs one turn; returns the final reply (or the validated typed value); and closes it. `peer(role)` returns a handle for several runs and `close()`. Every ephemeral peer still open is discarded when the execution ends, fails, or is cancelled. Discarding closes the peer and deletes its session record, assignments, and thread memberships; the transcript file stays. Ephemeral peers open a tmux window in the caller's server, or run headless (RPC mode) when the caller is not in tmux. The `type` and `profile` arguments are removed; the review and Ralph programs and skills use catalog roles.

**Blocked by:** 02 The directory and human-named manager tools, 06 Tasks are assigned

**Status:** in-progress

- [ ] With an attached peer, `peers["x"].run(task)` returns that turn's final text, the turn is in the peer's transcript, and the peer is still running afterwards.
- [ ] A run on a busy attached peer starts only after its own run settles.
- [ ] A loop of ten `agent(role=..., task=...)` calls never has more than one ephemeral window open, and leaves no ephemeral session record.
- [ ] An `output_schema` call returns a value that matches the schema; a reply that does not match fails the call.
- [ ] A cancelled program leaves no ephemeral peer running and no record behind.
- [ ] Outside tmux, `agent()` runs headless and still returns.
- [ ] The review and Ralph reference programs run with roles (no `builder`, no `type`).

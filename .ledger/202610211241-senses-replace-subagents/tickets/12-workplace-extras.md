# 12: Workplace extras

**Context:** [spec.md](../spec.md) defines the terms used here (person, operator, runtime, thread, push and pull, ephemeral task, intern) and records the decisions this ticket implements.

**What to build:** A new hire's first turn includes its team channel's recent history. `let_go` first asks the person to post a handover in the team channel (what is done, what is open, where things are), then retires them. The `<manager>` charter suggests a recurring short standup through `remind_me` and `meet` when the team needs one. The directory shows each person's track record.

**Blocked by:** 03 Team channels, 06 Tasks are assigned

**Status:** done

Implementation and evidence: [notes](../implementation-12.md).

- [x] A hire into a team whose channel has posts receives the recent posts in its first turn.
- [x] `let_go` produces a handover post from the person in the team channel before the person is retired.
- [x] The `<manager>` section mentions the standup option, and no tool for standups exists.
- [x] `directory` lists each person's finished assignments.

Deviations: No contract changes. The runtime publishes the person's final prose verbatim as its handover, atomically with retirement and the close outbox; it reuses the correlated-turn mechanism instead of adding another runner or handoff artifact. The existing directory record needed no new implementation.

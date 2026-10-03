# 07: Later generations: new roots and children of dead branches

**What to build:** When a generation has no survivor, the full planning function (spec 6.7) decides each next step. Top-ranked dead branches are enumerated from their own conversations, their children continue from their commits under the child directive (10.4), and each later generation also starts unused root positions. The search stays within the configured depth and total branch count. The planner also supports `draw: "model"` ordering (6.5).

**Blocked by:** 02 (Generation-0 search from a supplied scorer).

**Status:** ready-for-agent

- [ ] When generation 0 has no survivor, the dead branch with the most gates passed (then smallest `diff_size`, then node key) is enumerated from its own conversation in a worktree created from its commit, and its children start from that commit under the child directive.
- [ ] Each later generation also starts the configured number of next unused root positions.
- [ ] On the fixture repository with scripted replies, a child of the better dead branch survives and wins.
- [ ] The search stops with `no survivor` at the configured depth, never exceeds the configured total branch count, and stops when a step has no branch to run.
- [ ] A child branch's first request starts with its parent branch's full conversation.
- [ ] Child prompts never contain a gate id, a gate command, or scorer output (I2).
- [ ] Unit tests of the planning function cover each rule of spec 6.7 on synthetic trees, including `enumerate` for a parent without an enumeration and the `draw: "model"` order.

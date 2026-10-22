# Design It Twice

When the user wants to explore alternative interfaces for a chosen deepening candidate, ask peers for independent designs. Based on "Design It Twice" (Ousterhout): your first idea is unlikely to be the best.

Uses the vocabulary in [SKILL.md](../SKILL.md): **module**, **interface**, **seam**, **adapter**, **leverage**.

## Process

### 1. Frame the problem space

Before commissioning designs, write a user-facing explanation of the problem space for the chosen candidate:

- The constraints any new interface would need to satisfy
- The dependencies it would rely on, and which category they fall into (see [DEEPENING.md](deepening.md))
- A rough illustrative code sketch to ground the constraints, not a proposal, just a way to make the constraints concrete

Show this to the user, then immediately proceed to Step 2. The user reads and thinks while the peers work in parallel.

### 2. Commission independent designs

Use `pi_exec` with concurrent `agent(role="principal-engineer", task=...)` calls for the contrasting goals below. Each call has fresh context and closes its temporary peer when the proposal returns. Ask each peer for a **radically different** interface for the deepened module.

Give each peer a self-contained technical goal: file paths, coupling details, dependency category from [DEEPENING.md](deepening.md), and what sits behind the seam. Include the problem-space context from Step 1 and a different design constraint:

- Agent 1: "Minimize the interface: aim for 1–3 entry points max. Maximise leverage per entry point."
- Agent 2: "Maximise flexibility: support many use cases and extension."
- Agent 3: "Optimise for the most common caller: make the default case trivial."
- Agent 4 (if applicable): "Design around ports & adapters for cross-seam dependencies."

Include [SKILL.md](../SKILL.md) vocabulary and, when present, the relevant domain-language vocabulary from `.wiki/` in the brief so each peer names things consistently with the architecture language and the project's domain language.

Ask each peer to cover:

1. Interface (types, methods, params, plus invariants, ordering, error modes)
2. Usage example showing how callers use it
3. What the implementation hides behind the seam
4. Dependency strategy and adapters (see [DEEPENING.md](deepening.md))
5. Trade-offs: where leverage is high, where it's thin

### 3. Present and compare

Present designs sequentially so the user can absorb each one, then compare them in prose. Contrast by **depth** (leverage at the interface), **locality** (where change concentrates), and **seam placement**.

After comparing, give your own recommendation: which design you think is strongest and why. If elements from different designs would combine well, propose a hybrid. Be opinionated: the user wants a strong read, not a menu.

# Task Ledger

- `.ledger/202608162324-distill-observational-memory-current-state/task.md` — Distill observational memory into current working state
- `.ledger/202608162056-observational-memory-compacted-context/task.md` — Research observational memory in compacted context
- `.ledger/202608162041-slim-review-planner-drop-token-gates/task.md` — Slim review planning and drop review token gates
- `.ledger/202608160933-adapt-review-planning-for-speed/task.md` — Adapt review planning for focused, fast semantic coverage
- `.ledger/202608151843-bootstrap-gated-work-items/task.md` — Bootstrap gated task-local work items outside Ralph
- `.ledger/202608151813-build-harness-operations-ui/task.md` — Build interactive review, Ralph, and ledger-task operations UI
- `.ledger/202608151813-replace-caller-budget-arithmetic/task.md` — Replace caller-configured budget arithmetic with harness-owned limits
- `.ledger/202608151813-converge-typescript-architecture/task.md` — Converge TypeScript architecture, formatting, and quality controls

- `.ledger/202608181322-gate-compaction-on-real-context-window/task.md` — Gate compaction on real context usage within the configured window — Compaction currently gates on estimated source tokens (81k default) and ignores the model's configured contextWindow, so billed context reached 196k median / 331k p90 and crossed provider long-context price tiers. Gate on provider-reported usage relative to the configured window instead, with no model names in TypeScript.

- `.ledger/202608181322-merge-memory-consolidation-pass/task.md` — Merge memory consolidation into one curation pass — Observer, reflector, and dropper run as up to three sequential model calls re-sending overlapping input; merge them into one curation pass with coverage tiers and drop budget recomputed against post-record state rather than a pre-loop snapshot.

- `.ledger/202608181322-coalesce-advisor-reviews/task.md` — Coalesce advisor reviews without dropping deltas — The advisor drains immediately on every turn_end (one per assistant step), re-sending its whole accumulated history each time; defer the drain to batch low-signal steps while still pushing every delta, since a skipped delta is permanently absent from advisor context.

- `.ledger/202608181322-design-advisor-context-framing/task.md` — Design advisor context framing — Design (not yet implement) the advisor's context strategy: preserve user intent across a turn's kickoff plus all steering messages, carry rolled summaries and recent nudges, and prefer a framed anchored window over a sliding tail so cache reads survive until the next frame boundary.

# 09: Evaluation harness

**What to build:** The evaluation of spec section 18: closed ledger tasks become evaluation tasks with a base commit and oracle gates, and arms A (single trajectory), B (`draw: "model"`), and C (`draw: "random"`) run on them with the same model. B and C run once with oracle gates as the scorer and once with the authored scorer. Every final state is scored with the oracle gates. This ticket may split once oracle extraction is clear.

**Blocked by:** 04 (`/branch-search` with a hidden authored scorer), 07 (Later generations: new roots and children of dead branches).

**Status:** ready-for-agent

- [ ] For a closed ledger task, the harness derives its base commit and oracle gates (tests that fail on the base and pass on the final state), or reports why it cannot.
- [ ] The harness runs arms A, B, and C on the same model and task, B and C each with oracle gates and with the authored scorer, and scores every final state with the oracle gates.
- [ ] Per task and arm, the report lists solved, total tokens, cache read tokens, and wall-clock, plus for arm C the winner's rank relative to `preferred`, and it marks tail wins as spec 18 defines them.
- [ ] The first evaluation report exists in the task bundle.

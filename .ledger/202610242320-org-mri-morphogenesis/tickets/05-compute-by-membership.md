# 05: Compute counted by membership over time

Part of the approved spec [../spec.md](../spec.md); its Terms table defines obligation, completion, window, horizon, and the other words used here.

**What to build:** The history adapter adds compute-spent events: each person's model cost increase at the time it happened, counting only spend while the person was a member of the organization. Membership over time is rebuilt from what the runtime records: joining (a hire or a first start reporting into the organization), departures (`let_go`), and rehires; a reopen of a member is not a join. A session's first cost observation is a baseline, not spend, because the bridge reports all earlier spend from the transcript at its first hello. Contributions gain compute per person.

**Blocked by:** 04 (One evaluator and realized fitness from work).

**Status:** ready-for-agent

- [ ] Against a temporary state database built from real runtime event shapes, a person's spend before it joined and after it was let go does not count, and spend after its rehire counts again.
- [ ] A reopen of a sleeping member that reports earlier spend at hello adds no compute; new spend after it does.
- [ ] The spec's worked example now gives -$13, +$40.50, and +$27.50 for hours 0 to 2, 2 to 4, and 0 to 4, and windows still add up with compute in both.
- [ ] Contributions list compute per person, and the compute total equals their sum.

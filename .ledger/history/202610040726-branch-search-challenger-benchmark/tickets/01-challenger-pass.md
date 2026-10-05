# 01: Challenger pass

**What to build:** When the configuration sets `scorer.challengers`, the search attacks its own authored checks before any attempt runs. That many challenger forks each write a plausible but wrong solution to the goal in a copy of the base, and state the defect they planted; they never see the checks. The harness runs the gates on each challenger solution. A challenger solution that passes every gate exposes a gap: the author receives that solution's diff and stated defect, adds or sharpens a check, and the scorer is validated again, which now also requires that the gates reject that challenger solution. Only then does the scorer freeze and the enumerator start. Challenger content stays out of every attempt's reach, like the rest of the scorer. The record keeps each challenger's diff, stated defect, and whether the gates caught it. `branch-search.example.json` sets 2 challengers, and the branch-search docs describe the pass.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] With challengers configured and scripted replies, a challenger solution that passes every authored gate sends the author its diff and stated defect, and the frozen scorer's gates reject that challenger solution.
- [ ] A challenger solution that the authored gates already reject causes no author round, and the record marks it caught.
- [ ] Without `scorer.challengers`, no challenger fork starts and no challenger request is sent.
- [ ] No challenger diff, stated defect, or check content appears in any enumerator or attempt request, or on disk while an enumerator or attempt runs.
- [ ] The record holds each challenger's diff, stated defect, and caught or not, and its token cost counts in the search's cost.
- [ ] `branch-search.example.json` passes the configuration validator with 2 challengers, and the docs describe the challenger pass and its key.

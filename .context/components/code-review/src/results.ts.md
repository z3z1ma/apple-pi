## file

`unassignedRegions` counts regions a legacy plan declared as gaps; current plans never leave regions unassigned. `integrationOnlyRegions` are outside every focused scope and are reviewed only by the whole-change integration pass. Label fields are null on captures made before labels. `addressed` means settled with nothing left to act on: completed, no-changes, or cancelled, and every confirmed finding answered. Cost totals count attempts without a cost observation but do not price them; averages divide by attempts that have an observation. `settledAt` is null while work remains. `passes` is reviewer passes running now, against the concurrency bound.
Why: a legacy gap and a missing cost observation are recorded facts, not zero coverage or zero spend.
Verify: components/code-review/tests/contracts.test.ts

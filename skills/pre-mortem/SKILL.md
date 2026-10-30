---
name: pre-mortem
description: "Find plausible failure mechanisms before a consequential plan is committed. Use when assumptions, dependencies or irreversible steps deserve challenge; this imagines risks rather than observing an actual failure."
---

# Pre-mortem

Make a plan harder to surprise. Read and follow the [shared process conventions](../handbook-writing/references/processes.md).

The plan owner chairs with people who would experience its failure. Choose risk perspectives such as `architecture-prosecutor`, `staff-security-engineer`, `maintainer-from-three-years-ahead` or the affected operational owner.

1. **Fix the scenario.** State the plan, intended outcome, relevant horizon and commitments. Ask participants to suppose it failed and independently describe a concrete sequence that caused the failure. Keep these imagined cases labeled as hypotheses.
2. **Challenge the mechanisms.** Share cases in one thread. For each consequential risk, connect the failure to an actual assumption or dependency and identify an observable warning or discriminating check. Merge duplicate mechanisms without erasing different evidence.
3. **Return choices to the owner.** The authorized owner chooses mitigations, checks, accepted risks or a change to the plan. Record who owns each accepted action and what would reopen the commitment. Missing authority or evidence stays visible.

Done is a plan with explicit risk decisions and owned checks, not a longer list of frightening possibilities. Use [failure-exercise](../failure-exercise/SKILL.md) when the next useful result requires observing an authorized controlled fault.

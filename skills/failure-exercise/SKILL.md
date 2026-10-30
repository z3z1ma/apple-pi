---
name: failure-exercise
description: "Observe how a system and its response process behave under an authorized controlled fault. Use to test recovery and coordination before a real incident; imagined failure scenarios belong in pre-mortem."
---

# Failure exercise

Turn a recovery assumption into observed evidence without exposing unrelated work. Read and follow the [shared process conventions](../handbook-writing/references/processes.md).

The exercise owner coordinates a `chaos-engineering-specialist` for fault design, the affected service/domain owners and authorized operators. Advisory fault design is distinct from permission to inject it.

1. **Prove the boundary before acting.** Agree the hypothesis, exact target, allowed effects, stop conditions, restoration owner and observation method. Confirm isolation and the recovery path. Obtain the needed authority for these effects; a generic request to test does not authorize a production outage.
2. **Inject and observe.** Establish the healthy control, apply the bounded fault and record what actually happens. Use [incident-response](../incident-response/SKILL.md) methods when testing coordination. Keep planned behavior separate from observed actions and preserve the timeline.
3. **Stop and restore.** Follow the agreed stop conditions, remove the fault and verify restoration against the control. Account for each resource the exercise created. An incomplete cleanup remains an owned problem.
4. **Act on the result.** Report the hypothesis supported or contradicted, observation limits, recovery evidence and accepted follow-up. A failed hypothesis is useful evidence; it is not a reason to conceal or broaden the test.

Done includes verified restoration and an evidence-backed conclusion. It does not certify resilience to faults or scales that were not exercised.

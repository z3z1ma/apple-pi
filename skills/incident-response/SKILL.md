---
name: incident-response
description: "Coordinate recovery from active harm or service disruption. Use when response needs shared priorities, controlled changes, stakeholder updates or command handoff; diagnosing a bug alone is a separate method."
---

# Incident response

Restore the affected outcome while keeping response actions controlled. Read and follow the [shared process conventions](../handbook-writing/references/processes.md).

Name an incident lead and an operational change owner. A `service-owner` carries continuing accountability; `principal-site-reliability-engineer` advises; authorized implementers or release engineers make changes. Add security, database or distributed-systems expertise when the failure warrants it. Begin safe work with available responders rather than wait to staff a complete board.

1. **Establish impact and authority.** State what is failing, the immediate objective, recovery condition and permitted actions. Keep the current incident state, actions and unknowns in the governing task. Diagnosis can use [diagnosing-bugs](../diagnosing-bugs/SKILL.md); restoration need not wait for causal certainty.
2. **Coordinate changes.** Proposed system changes go through the operational owner so responders can see and resolve conflicts. Preserve evidence and compare each mitigation with user impact. An advisory role remains advisory; incident urgency grants no additional access or production permission.
3. **Keep people informed.** Use one response conversation. Separate stakeholder updates when their questions would interrupt operational work. Set the next useful update from the incident's needs, with current facts rather than invented recovery estimates. If this communication system fails, report the limit and use an already available authorized route.
4. **Hand over or recover.** A successor explicitly accepts command and current state before the outgoing lead announces the transfer. Declare recovery only after checking the stated condition; assign remaining risks and corrective work to their continuing owners.

Done is verified recovery with follow-up owned, or an explicit continuing-incident handoff. Follow with deeper [retrospective](../retrospective/SKILL.md) when useful; keep unexplained causes unexplained.

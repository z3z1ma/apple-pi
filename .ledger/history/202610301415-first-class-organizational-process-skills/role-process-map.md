# Let processes and roles challenge each other

This is a planning audit of the pre-implementation catalog after the operator's sign-off notes, not a runtime routing table or a usage report. Shipped additions and their validation are tracked in [implementation evidence](implementation-evidence.md).

## What the current catalog actually contains

Source inspection found **32 roles**. Only **`coordinator` and `director-of-engineering` have `manages: true`**. Five roles have `writes: true`: those two managers, `implementation-engineer`, `release-engineering-lead`, and `technical-writer`. The other 27 roles are advisory/read-only.

Titles do not confer capabilities. `vp-of-product` asks whether work is worth doing but cannot staff it. `quality-engineering-director` explicitly does not own test implementation, execution or risk acceptance. `principal-ux-researcher` forms hypotheses and methods, not a sustained discovery program. `release-engineering-lead` can write and execute bounded release work but does not manage people or own ongoing service health.

The first proposal explicitly named 14 of the 32 roles. That is a measure of this draft's framing, not evidence that the other people are idle, unused or unhelpful. Some roles already enter through an existing skill; others are specialized by design. Still, the omissions exposed an overly generic choice of critics and an underdeveloped set of management jobs.

## Start from missing accountability, not missing titles

Recommend adding these standing jobs while authoring the first delivery set. Each uses ordinary `roles/*.md` with writing and management capabilities; none requires a new runtime privilege or a mandatory reporting layer.

| New role | Distinct continuing responsibility | Boundary against existing roles | First consumer |
| --- | --- | --- | --- |
| `product-manager` | Own a product outcome through problem discovery, priority choices, accepted delivery and learning from use. Coordinate the people assigned to that outcome. | VP of Product independently challenges whether the bet is worthwhile; the product manager carries an authorized bet forward. The operator still owns reserved product and investment decisions. | Decision review; later discovery and prioritization |
| `engineering-manager` | Own a team's capacity, delivery commitments, integration and ability to sustain its work across assignments. | The director handles trade-offs across initiatives and teams; the coordinator handles operator-wide flow. This role supplies local delivery ownership, rather than sending every seam upward. | Tiger team, handoff and operating review |
| `service-owner` | Own an assigned service's operational health across releases, incidents and corrective work, with explicit authority over the relevant people and commitments. | SRE advises on failure and recovery; release engineering owns a rollout. The service owner carries the continuing obligation and closes the follow-through. Production access and action consent remain separate. | Incident response, operating review; later release readiness |

Keep `research-lead` as a concrete further candidate: someone accountable for a program of uncertainty reduction, its investigators, methods, conflicting evidence and decision consequences. It becomes useful with discovery or the experiment-cycle process below. A single bounded lookup still belongs with the existing research tool/skill; a manager title should not turn it into a program.

These are proposed jobs, not a target number of managers or an instruction to hire them all. Available roles need not all be instantiated. Author and exercise their distinctive responsibilities; narrow or merge a role if the process cannot demonstrate why another owner is insufficient. Preserve the current advisors rather than flipping their management flags on the strength of a senior-sounding title.

## The inverse map identifies useful invitations and missing processes

| Existing role | Where its contribution belongs | What the first draft missed or already reused |
| --- | --- | --- |
| `accessibility-specialist` | User-facing decision review, release readiness, receiver's handoff check | A generic quality lens can miss excluded users and input modes. |
| `architecture-prosecutor` | Decision review or pre-mortem for a structural commitment | Strongest-case opposition differs from general evidence skepticism. |
| `chaos-engineering-specialist` | Controlled failure exercise; preparation for incident response | A real outage is the wrong first time to learn whether coordination survives failure. |
| `chief-architect` | System-boundary decisions and long-lived contracts | Already a proposed default; unnecessary for routine non-architectural choices. |
| `code-review-specialist` | Existing `code-review`, used during delivery | Already has an owner; absence from the new-skills default list is not a gap. |
| `coordinator` | Intake, follow-through and cross-work communication | Useful standing responsibility, but not the default owner of every product, service or team. |
| `database-reliability-architect` | Migration decisions, data incidents, failure exercises | Specialist input when isolation, corruption or reversibility decides the outcome. |
| `developer-experience-lead` | API decisions, consuming-team handoff, adoption | Tests whether another person can actually use the interface. |
| `director-of-engineering` | Cross-team commitments, conflicts and portfolio delivery | Retain the broad authority; reduce unnecessary escalation of local team work. |
| `distinguished-member-of-technical-staff` | Open the solution space in a decision or discovery process | Challenge the framing before judging the supplied options. |
| `distributed-systems-researcher` | Concurrency/recovery decisions and controlled failures | Generic challenge is insufficient when coordination correctness is the risk. |
| `end-user-customer-advocate` | Decision, discovery and release acceptance | Represent consequences for users while distinguishing advocacy from actual user evidence. |
| `implementation-engineer` | Existing implementation work within delivery or mitigation | Already reused. A bounded builder should not quietly inherit program management. |
| `infrastructure-cfo` | Prioritization, operating review and due diligence | Cost, lock-in and maintenance can change a choice without making dollars the universal objective. |
| `maintainer-from-three-years-ahead` | Decision, handoff, retirement and adoption checks | Immediate delivery is not the whole ownership cost. |
| `new-team-member` | Handoff, explanation and onboarding cold reads | Already proposed. Comprehension is distinct from technical verification. |
| `paradigm-outsider` | Consultation or a decision trapped inside one approach | Already proposed; use when reframing could help, not as compulsory novelty. |
| `performance-engineering-lead` | Operating constraints and performance-sensitive decisions | Separates measured bottlenecks from apparent busyness. |
| `principal-engineer` | Feasibility and codebase-grounded planning | Already proposed. Planning advice does not itself own a team's delivery. |
| `principal-site-reliability-engineer` | Incidents, readiness, operational decisions and exercises | Already proposed as advice; continuing service ownership is a separate job. |
| `principal-ux-researcher` | Discovery, usability experiments and adoption | Needs a real evidence-gathering path; agent opinion is not a user study. |
| `quality-engineering-director` | Design the checks for delivery, readiness and process exercises | Already proposed. Other owners must implement, run and act on those checks. |
| `release-engineering-lead` | Real rollout, rollback and readiness | Already proposed. Writing authority does not confer team management. |
| `repository-archaeologist` | Legacy decisions, handoffs and incident investigation | Recover hidden assumptions before drafting another plan from present appearances. |
| `scientific-skeptic` | Challenge consequential causal or evidence claims | Too frequent as a generic stand-in in the draft; use subject-matter challenge when that is what the decision lacks. |
| `skeptical-first-time-user` | Handoff, discovery and release acceptance | Actual first-use behavior differs from a document comprehension test. |
| `staff-engineer-simplicity` | Decision review, operating change and retrospective proposals | Challenge whether the proposed process or solution earns its machinery. |
| `staff-security-engineer` | Trust-sensitive decisions, incident response and due diligence | Data exposure and authorization need a distinct security lens. |
| `technical-due-diligence-partner` | Adoption, migration and irreversible commitments | Suggests a due-diligence process before inheriting ownership liabilities. |
| `technical-writer` | Handoffs, incident state/runbooks, retrospective promotion | Preserve usable context with its existing owner rather than appointing a second knowledge registry. |
| `test-and-ci-operator` | Run the checks for delivery and controlled exercises | Design, execution and acceptance of a check are separate responsibilities. |
| `vp-of-product` | Challenge value in decision review, discovery and prioritization | Retain independent product judgment; add accountable product management rather than mislabel advice as ownership. |

## Let the audit widen the candidate portfolio

Three useful possibilities emerge beyond the original five later candidates:

- **Failure exercise:** test a system and its response process under a controlled injected failure. It produces observed limits and owned improvements, not just a prediction of what an incident team would do. Reuse incident-response methods inside the authorized exercise.
- **Due diligence:** before adopting a dependency, vendor, protocol or data format, assemble evidence about liabilities, security, maintenance, cost and exit options. It produces a verified basis for a decision; decision review still owns the choice. First evaluate whether a decision-review reference is enough.
- **Experiment cycle:** turn a contested assumption into a discriminating experiment, execute it, reconcile the evidence and decide whether to continue, change direction or stop. Reuse research and prototype methods; distinguish a general inquiry from diagnosing an existing bug. A research lead becomes useful when this spans investigators and continuing commitments.

These are candidates, not an instruction to expand the first delivery set. They show how role inspection can expose missing work without manufacturing a process for every catalog entry.

## Reassess from real exercises

Record which perspectives could change each exercise's outcome, which were included, what they contributed and what they could not establish. Investigate repeated concentration: it may mean good generalists, missing management jobs, poor descriptions, unnecessary role overlap, or neglected risks. The count alone decides none of these.

Exercise each new manager's actual boundary: a product manager can reconsider an authorized priority but cannot expand the operator's product mandate; an engineering manager owns integration rather than only forwarding messages; a service owner carries recovery follow-up after responders leave. For every role, it must also be possible to name work that belongs elsewhere.

Use this map to improve the authored descriptions and process guidance. Keep live staffing with the ordinary directory and management tools. Do not install the planning matrix as a second role catalog or automatic routing mechanism.

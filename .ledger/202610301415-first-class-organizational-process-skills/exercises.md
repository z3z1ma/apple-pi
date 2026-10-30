# Controlled process exercises

Root authored the entire handbook, roles, integration changes and toy probes. Niamh Virtanen and Riku Fischer participated only as exercise subjects. They did not build or review the implementation.

## Isolation and evidence boundary

Both people had zero held assignments before reopening. They received new, zero-valued exercise assignments and synthetic facts. Their existing work was unchanged. Native conversations and exercise assignments used the real organization; this was not an isolated runtime. The cache programs and results live only in this task bundle, contain no private application data and act on in-memory Maps. No production service, external message or live application change was attempted.

The owner deliberately selected both processes and seeded the cases. The result is evidence of these participants following the supplied instructions and exchanging useful reasoning, not evidence of autonomous process selection, newly added managers' effectiveness or general organizational benefit.

## Peer consultation

Thread: `t-2e58c6a7-784e-4aa0-b84e-10882b092213`, messages 7005-7017.

- Fresh readiness acknowledgments preceded the exercise (task messages 7003-7004).
- Private facts differed: Niamh knew component fixtures reset the cache; Riku knew B failed after A warmed it and both viewers could remain logged in.
- Both asked for expected/actual results before advising and shared their facts directly (7008-7011). They explicitly treated the lifetime difference as missing coverage, not a proven cause.
- Root clarified the fixed-identity, viewer-specific contract (7012).
- Their shared exchange refined the probe: cold-B control versus shared A-then-B, lookup key and hit/miss instrumentation, and a miss-but-wrong branch that would contradict simple reuse (7013-7016).
- Root chose and executed `node cache-probe.mjs`. `cache-probe-results.json` records a cold-B success and the constructed warm-cache wrong hit under the same tenant key. Root retained ownership and closed the consultation (7017).

This was a deliberately faulty fixture. The probe did not discover a defect in apple-pi or an external application.

## Decision review

Private initial positions: Niamh task thread `task:work-d0786851-e9a2-4d6c-801c-5e5ecdbef473`, message 7021; Riku task thread `task:work-31a9eb95-a762-4dcb-8e20-af8b895c2fc9`, message 7020.

Shared thread: `t-930e0215-c2ef-4099-ac59-b764d200a2cf`, from message 7022.

- Both independently preferred tenant+viewer keys over logout clearing for concurrent valid viewers. Their initial statements were private until root published both together.
- Root introduced a labeled, seeded counterproposal: logout clearing is a smaller patch and stores fewer entries. This was not a spontaneous minority position.
- Both answered why that trade-off fails the stated output contract before logout. Niamh challenged output-only validation because cache bypass could pass it; Riku narrowed a storage claim to entry count rather than unmeasured bytes/cost. Their direct exchange converged on A-then-B-then-A with useful repeat hits (7023-7029).
- Root executed `node decision-probe.mjs`. Viewer keys returned A/B/A with miss/miss/hit; logout clearing returned A/A/A with miss/hit/hit before the successful clearing control. Results are in `decision-probe-results.json`.
- Root chose viewer keys for the toy, preserved the objection and limits, named reopening conditions, and requested a brief closeout plus separate assignment completion (7030).

Closeouts arrived at 7031-7032; both participants finished their assignments at 7033-7034. They named concrete improvements to their reasoning and a low-value extra exchange about a fourth request. Niamh also reported that the consultation was archived before her reflection reply arrived, so it was refused. Root corrected the shared convention to collect the closing exchange before archiving, and kept the decision discussion open until both closeouts arrived. Both participants were verified idle with zero held work before being sent home.

This did not exercise a parallel data race, mutable permissions, production identity trust, real memory cost, missing reviewers or delivery failure. The toy implementations are comparison fixtures, not product cache implementations.

## Per-process coverage

Every process passed package discovery/reference checks and the live metadata-only selection case in `selection-results.json`.

| Process | Additional evidence / remaining limit |
| --- | --- |
| peer-consultation | Native exchange above; unavailable-peer recovery not exercised. |
| decision-review | Native exchange above; seeded objection, no spontaneous dissent or missing-critical-reviewer case. |
| tiger-team | No live cross-team delivery/integration-failure exercise. |
| handoff | No live receiver-demonstration/failed-transfer exercise. |
| incident-response | No live incident, conflicting operational changes or command-transfer exercise. |
| operating-review | No live operating intervention or observed improvement. |
| retrospective | Only the brief closeouts of the two exercises; no deeper retrospective exercise. |
| pre-mortem | No multi-person prospective-risk exercise. |
| prioritization | No live portfolio commitment or capacity-allocation exercise. |
| release-readiness | No real release decision, rollout or rollback exercise. |
| discovery-workshop | No customer inquiry or problem-framing exercise. |
| onboarding | No demonstrated newcomer-readiness exercise. |
| failure-exercise | No system fault-injection/restoration exercise; the synthetic cache probes are not that proof. |
| due-diligence | No real dependency/vendor inquiry or adoption decision. |
| experiment-cycle | Root ran the stated toy comparisons; no multi-person execution of this skill or causal-benefit proof. |

The four new roles passed catalog parsing, capability assertions and manager-enabled peer schema/guidance tests. None was instantiated as a new manager for this exercise; continuing management performance remains unverified.

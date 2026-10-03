## Problem Statement

A maintainer must understand several overlapping implementations to change how public subagent outcomes are presented. Root results, nested results, and notifications select result text and combine status fragments in different places. Small shared helpers leave callers responsible for composition order and delivery-specific rules. This reduces locality and makes verification depend on both helper behavior and caller assembly.

No incorrect outcome behavior has been established. The undertaking is a behavior-preserving deepening, not a product change.

## Solution

Concentrate shared outcome decisions behind one smaller framing interface used by root results, nested results, and notifications. Preserve each delivery context's existing wording and affordances. Keep persistence, agent lifecycle, and delivery mechanics with their existing owners.

Here, **outcome framing** means selecting response text and qualifying what that text represents. **Root results** return to the main agent; **nested results** return to the public subagent that delegated the work; **notifications** announce background outcomes. A **resume handle** is the agent ID and guidance for continuing an existing live session.

The module earns depth by hiding decisions callers currently assemble. Moving helpers into another file without reducing caller knowledge does not satisfy this specification.

## User Stories

1. As a maintainer, I want shared outcome decisions in one module, so that a change has locality.
2. As a maintainer, I want a smaller framing interface, so that callers need fewer composition rules.
3. As a maintainer, I want root and nested results to share outcome meaning, so that separate delivery implementations do not duplicate those decisions.
4. As a maintainer, I want notification framing to use the same shared decisions, so that result content and displayed details remain consistent.
5. As a main agent, I want completed results to retain their current content, so that the refactor does not alter the information I receive.
6. As a main agent, I want failed runs labeled as failures, so that partial output is not mistaken for successful completion.
7. As a main agent, I want available partial output retained after failure, so that useful work remains recoverable.
8. As a main agent, I want failures without partial output to retain their current fallback, so that no output is invented.
9. As a main agent, I want operator-stopped outcomes to retain their explicit wording, so that human intervention is not confused with completion.
10. As a main agent, I want turn-limited and wrapped-up outcomes distinguished, so that their existing completion qualifications remain visible.
11. As a main agent, I want foreground results to retain their complete-output wording, so that I am not given a false cue to fetch more settled output.
12. As a main agent, I want background and retrieved results to retain their delivery-specific wording, so that presentation remains appropriate to the existing context.
13. As a public subagent, I want nested results to retain their current framing, so that delegation continues to convey the same meaning to my parent.
14. As a main agent, I want successfully saved output represented by its path, so that its response body is not duplicated in the parent transcript.
15. As a main agent, I want inline output retained when saving fails, so that a persistence error does not lose the response.
16. As a main agent, I want execution failure and output-write failure both retained when applicable, so that neither failure is hidden.
17. As a main agent, I want continuation advertised only when a live session exists, so that a startup failure does not suggest an unavailable resume action.
18. As a main agent, I want resume handles to remain on their existing delivery surfaces, so that the refactor adds no new affordances.
19. As an operator, I want existing file-change reporting preserved, so that outcome framing does not remove the record of traced changes.
20. As an operator, I want notification timing and delivery unchanged, so that the refactor does not introduce duplicate or missing notifications.
21. As a maintainer, I want outcome tests to cross the caller-facing interface, so that they survive changes inside the implementation.
22. As a maintainer, I want existing tool-level delivery checks retained, so that correct framing is still exercised through real callers.
23. As a maintainer, I want persistence checks to remain with the persistence owner, so that presentation and file-writing responsibilities remain distinct.
24. As a maintainer, I want agent state machines unchanged, so that a framing refactor does not expand into lifecycle redesign.

## Implementation Decisions

- Build one deep subagent outcome-framing module serving the existing root-result, nested-result, and notification callers. Keep it within subagent ownership rather than introducing a generic operations module.
- The framing implementation owns shared result selection, partial-output framing, delivery-context wording, saved-output presentation, and resume-handle eligibility.
- Preserve observable behavior, including current text, fallback selection, whitespace treatment, context-specific placement of status notes, and continuation affordances. Root and nested formatting differences are not authorization to normalize them.
- Foreground wording must remain distinct from background or retrieved-result wording. Preserve the current distinction between operator stop, an aborted turn-limited run, and a run that wrapped up at its turn limit.
- Saved-output presentation reports the existing path after successful persistence instead of reproducing the response body. Persistence failure retains the existing write-error framing and inline response; execution failure remains visible when applicable.
- Resume eligibility depends on the existence of a live session. Eligibility does not authorize adding a handle to a delivery surface that does not currently provide one.
- Root callers retain transcript inspection, its existing bypass cases, and persisted-response omission behavior. Nested callers retain their existing active-status and transcript-tail behavior.
- Callers retain XML envelopes, preview truncation, file-change reporting, delivery scheduling, and notification-consumption policy. The shared module must not acquire these responsibilities merely to make every output look identical.
- File-path resolution and file persistence remain separate from presentation. Preserve persistence timing, output markers, and error accounting.
- Keep the agent manager and runner state machines intact. Introduce no new adapter, configuration, runtime registry, compatibility path, or extension point for this in-process change.
- Absorb the shallow framing fragments and repeated caller decisions into the implementation; do not retain parallel framing implementations or add a pass-through module over the current helper chain.
- The exact callable names and return shape are not prescribed. They must express the settled responsibilities without requiring callers to know the internal framing order.

Acceptance criteria:

- Root results, nested results, and notification result selection use the shared framing interface instead of independently assembling the shared rules.
- Delivery-specific results remain observably unchanged for the cases in Testing Decisions.
- Deleting the shallow fragments requires only moving their small string choices internally; deleting the proposed deep module would make the hidden framing decisions reappear across callers.
- Existing persistence, lifecycle, transcript, preview, and file-change responsibilities remain with their existing owners.
- Tests prove the behavior through the confirmed seams rather than inspecting private state or duplicating caller assembly.

## Testing Decisions

The user confirmed these seams on 2026-10-03 during the specification invocation:

- **Primary seam:** the framing module's caller-facing interface. Exercise it with in-memory outcome records, without model calls or filesystem writes. The interface is the test surface.
- **Retained integration seams:** existing root and nested tool-result delivery checks and notification checks. These prove callers use framing correctly while retaining their own delivery responsibilities.
- **Retained persistence seam:** existing persistence tests remain with that owner. Framing tests use already-established persistence outcomes; they do not write files.

Good tests assert observable text and eligibility through the interface, not helper order, private functions, or a particular internal decomposition. Preserve exact wording where it is part of the current model-visible contract. Replace assertions on absorbed helpers with coverage through the framing interface rather than layering redundant tests over discarded implementation details.

Cover these observable cases, for the delivery contexts where they currently apply:

- Clean completion with result text, and existing no-output fallbacks.
- Failure with non-empty partial output and failure without partial output.
- Operator stop, aborted turn-limited output, and wrapped-up turn-limited output.
- Foreground versus background/retrieved wording, including existing root/nested differences.
- Successful saved-output presentation, persistence failure with recoverable inline output, and simultaneous execution/write failure.
- A live session versus no live session for continuation eligibility; preserve which callers include the handle.
- Notification result content and displayed outcome details retain their existing meaning.

Retain integration coverage for foreground launch and resume, nested results, result retrieval, notification preview handling, traced file changes, and saved-output delivery. Preserve active-status and transcript-tail behavior in callers rather than forcing those paths through a settled-result presentation.

Prior art includes existing notification truncation and file-change checks, persistence-failure recovery checks, foreground saved-output delivery checks, and nested tool execution checks in the subagent suites. These are evidence and retained verification, not permission to preserve an obsolete behavior over the governing product contract. If a substantive contradiction is found during implementation, stop and return to design rather than changing the contract silently.

A later TDD invocation requires its own fresh seam confirmation before changing tests.

## Out of Scope

- Wording improvements, new statuses, changed result selection, or new continuation affordances.
- Agent/task unification or a generic outcome framework.
- Changes to file persistence, path resolution, persisted-response markers, or output-write timing.
- Changes to agent ownership, queueing, cancellation, retention, notification batching, result consumption, or lifecycle state machines.
- Changes to transcript inspection, XML envelopes, preview budgets, file-change reporting, or delivery scheduling.
- New adapters, configuration options, compatibility implementations, session stores, or tool/schema surfaces.
- Work-panel or reflection refactors.
- Production implementation, ticket generation, commits, publication, deployment, or external tracker mutation as part of writing this specification.

## Further Notes

The operator selected outcome framing from an architecture survey, agreed to behavior preservation and responsibility placement, and explicitly approved both a new ledger task and the proposed test seams. No research or prototype hand-off remains open.

Authority and supporting sources:

- [Repository maintainer instructions](../../AGENTS.md): narrow ownership, minimal implementation, retained cohesive state machines, and behavioral testing.
- [Development conventions](../../docs/development.md): cohesive modules and intended thin integration registration.
- [Subagent product contract](../../docs/subagents.md): results, persistence, continuation, nested ownership, and notifications. This is the product authority.
- [Adopted and rejected architecture](../../docs/boundaries.md): one implementation per responsibility, no generic operations model, and no second subagent runtime.
- [Working domain language](../../.wiki/pages/domain-language.md): supporting vocabulary for main agent, public subagent, and interactive child session; not a competing product contract.
- [Existing subagent tests](../../components/subagents/tests/subagents.test.ts) and [runner integration tests](../../components/subagents/tests/subagent-runner-e2e.test.ts): executable precedent for outcome and delivery checks.

The specification is a task snapshot. A material redesign requires returning to design and updating this same specification before downstream work continues.

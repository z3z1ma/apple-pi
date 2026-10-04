# Coding-child reflections and shared learning

## Problem Statement

Delegating implementation to an interactive subagent currently removes two automatic disciplines present in the primary session: change review and learning reflection. The primary's change-review tracker observes its own successful built-in `edit` and `write` calls, not a child's edits. Interactive children explicitly omit change review and notebook ownership, even when they have a pair programmer.

The coding child has the fullest account of its implementation choices, failures, recoveries, and validation. Its ordinary handoff compresses that account. The operator wants delegation to retain engineering discipline: return a reviewed artifact and capture useful discoveries in the shared notebook, without requiring the primary to reconstruct the child's work.

Loading the primary's existing post-settle forks into children would not provide that guarantee. A child could return completion while a detached review still changes its files. The final report could then describe checks that preceded the final edits.

## Solution

Write-capable interactive children perform automatic change review and learning reflection inside their own session before handing off. The primary retains its existing passive forks.

Eligible children use `agent_before_settle` to request one in-band continuation. When both activities are due, that continuation reviews and revalidates the changes, captures worthwhile learnings, and returns a full implementation report updated for the final artifact. The child remains subject to ordinary cancellation and turn limits. Keeping the changes and recording no new learning are valid outcomes.

The primary owns one shared notebook for its delegation tree. Coding children and their pair programmers can read it and contribute validated, add-only learnings during work or reflection. Contributions retain access to their original cited evidence in the primary session archive, including when the child itself is ephemeral. The primary and its pair retain notebook curation authority.

### Terms used here

- **Primary** is the root Pi session that owns the notebook and delegation tree. A nested child's immediate parent can be another child; it is not a separate notebook owner.
- **Coding child** is an interactive subagent with active built-in `edit` or `write` capability. A Pi Exec model worker is a different execution context and remains out of scope.
- **Invocation** is one initial child run or one resume. The child session can span several invocations; the one-pass reflection guard applies separately to each.
- **In-band continuation** is further work in that same child session before the invocation returns. It is not a detached fork. **Pre-settle** names the boundary at which Pi can request this work before declaring the run finished.
- **Ephemeral child** has no persisted transcript. Retaining its cited evidence in the primary archive keeps notebook recall available after the child is disposed.

## User Stories

1. As an operator, I want delegated implementation to retain automatic review and learning capture, so that delegation does not bypass the primary session's engineering discipline.
2. As a primary agent, I want a coding child's result to arrive after its pre-settle work finishes, so that integration starts from the final reviewed artifact.
3. As a coding child, I want review to run in my existing conversation, so that it uses the task intent, implementation evidence, tools, and validation already available to me.
4. As an operator, I want eligibility to follow active built-in editing capability, so that custom coding agents receive the same discipline as built-in coding roles.
5. As an operator, I want inference profile selection to remain separate from capability, so that selecting a coding model does not grant tools or activate implementation behavior by itself.
6. As an operator, I want hooks to remain enabled when I use `pair: false`, so that opting out of the pair does not also remove author review and learning reflection.
7. As an operator, I want eligible children to receive the hooks without a new opt-out switch, so that the public configuration surface stays small.
8. As a non-implementing interactive child, I want coding hooks to remain absent when I lack active built-in `edit` and `write`, so that advisory work does not receive an implementation completion phase.
9. As a coding child, I want a successful built-in edit or write to trigger change review after a completed invocation, so that the review is attributable to my recorded work.
10. As a coding child, I want no change review when I made no successful built-in edit or write, so that an inspection-only invocation does not manufacture changes to review.
11. As a coding child, I want the code lens to seek a simpler implementation that preserves required behavior, so that review improves clarity without changing the task.
12. As a coding child, I want the test lens to check observable behavior wanted now, so that my tests protect the requested result rather than an abandoned approach or an implementation detail.
13. As a coding child, I want the prose lens to consider a reader without this conversation, so that delegated documentation stands on its own.
14. As a coding child, I want review to consider what ran after each file's last change, so that I report only supported validation claims and identify missing checks.
15. As an operator, I want review improvements to remain within the assigned scope and be revalidated where affected, so that automatic review does not become an unbounded redesign.
16. As a coding child, I want keeping the result unchanged to count as a valid review outcome, so that the hook does not force unnecessary edits.
17. As a primary agent, I want the final child report to reflect review edits and subsequent checks, so that an earlier implementation report cannot misrepresent the handed-off artifact.
18. As an operator, I want change review and learning reflection to share one continuation when both are due, so that there is no mandatory extra request solely to separate the activities.
19. As a coding child, I want each hook scheduled once per invocation, so that edits made during review do not cause another automatic review.
20. As a primary agent, I want each resumed invocation to receive its own completion discipline, so that prior hook execution does not suppress review of new work.
21. As a coding child, I want learning reflection at every completed eligible invocation, so that a bounded assignment does not finish before a token-spaced reflection becomes due.
22. As a coding child, I want learning reflection even when a completed invocation made no edits, so that investigation and successful discoveries can still teach something useful.
23. As a coding child, I want permission to record no learning, so that the notebook holds useful discoveries rather than obligatory filler.
24. As a coding child, I want to record a learning when I discover it during work, so that capture does not depend solely on remembering it at handoff.
25. As a primary agent, I want children at every delegation depth to contribute to my notebook, so that learnings are not fragmented across immediate-parent notebooks.
26. As a coding child, I want add-only access to the shared notebook, so that I can contribute discoveries without removing or replacing another participant's conclusions.
27. As a child's pair programmer, I want to add missed learnings under the same add-only authority, so that useful observations are captured even when the implementing child misses them.
28. As a primary agent or its pair, I want to retain superseding, retirement, and full-maintenance authority, so that shared curation stays with participants who have the wider session context.
29. As an operator, I want concurrent validated child contributions to be preserved, so that parallel delegation does not lose accepted learnings.
30. As a notebook reader, I want child-originated learnings to lead back to original conversation, commands, and results, so that I can inspect evidence rather than rely only on the child's report.
31. As a notebook reader, I want the child's identity and source provenance preserved with retained evidence, so that copied evidence is not mistaken for work performed by the primary.
32. As an operator, I want only cited child evidence retained in the primary archive, so that evidence retention does not copy whole child transcripts.
33. As a notebook reader, I want exact recall after an ephemeral child is disposed, so that learning evidence is not lost with the temporary session.
34. As a coding child, I want a shared-learning snapshot at launch, so that known discoveries can guide my initial work.
35. As a coding child, I want a fresh shared-learning snapshot after compaction, so that ongoing work retains the notebook's current guidance.
36. As a coding child, I want explicit fresh reads and exact recall, so that I can consult updates without receiving every sibling contribution automatically.
37. As a child's pair programmer, I want to read and recall shared learnings, so that I can coach using the same retained knowledge available to the child.
38. As an operator, I want notebook guidance to preserve append-only context, so that sharing learning does not rewrite cached conversation prefixes.
39. As an operator, I want accepted contributions to survive later child failure or cancellation, so that useful discoveries are not rolled back with an unfinished implementation.
40. As an operator, I want normal stop, navigation, shutdown, and turn-limit behavior to apply to in-band reflection, so that automatic work does not escape the child's lifecycle.
41. As a primary agent, I want a failed pre-settle model continuation to produce an ordinary failed-child outcome, so that unfinished review is not presented as successful completion.
42. As a primary agent, I want notebook capture gaps reported without automatically failing otherwise successful coding work, so that the implementation remains deliverable and the missing learning stays visible.
43. As a coding child, I want to consult available parent clarification for ambiguous intent and report what remains unresolved, so that automatic review does not invent user authorization.
44. As a primary agent, I want one updated full handoff with review status, validation gaps, and a brief learning summary, so that I do not need a second root notification to understand the outcome.
45. As an operator, I want primary-session passive forks and Pi Exec worker behavior left unchanged, so that this child-session change stays within its agreed boundary.

## Implementation Decisions

### Session scope and activation

- Apply the design to interactive coding children, including ownership-scoped nested children. Pi Exec model workers are excluded.
- Determine eligibility from the child's actual active built-in `edit` or `write` capability. Agent names and model profiles are not eligibility rules.
- Enable the hooks for every eligible child independently of pairing. Introduce no new hook opt-out setting or invocation parameter.
- Preserve existing trust, tool restrictions, nested-delegation ownership, and root-only capability boundaries. Notebook integration does not grant implementation or orchestration permissions.

### Reflection execution

- Keep primary-session automatic reflections as passive post-settle forks, with their existing triggers and cadence.
- Use the actionable `agent_before_settle` boundary for eligible child reflections. Append the reflection instruction to the child's conversation and request ordinary session continuation; do not create a reflection fork or a runner-owned model loop.
- Preserve accumulated boundary entries when composing with other handlers. Pi's boundary API supports entries and a continuation request; its handlers chain proposed state.
- Retain the existing change-review trigger: a completed invocation with successful built-in `edit` or `write` calls. Failed tool calls and mutations performed through other paths do not become tracked edits.
- Retain the current review lenses and post-change execution evidence: observable wanted behavior for tests, simplicity for other code/non-prose, reader clarity for prose, truthful validation claims, and revalidation of affected improvements.
- Run child learning reflection at every completed eligible invocation, including resumes and invocations without tracked edits. Child learning reflection does not use the primary's 500,000-new-token spacing.
- When both activities are due, request one combined continuation instructed to review and revalidate first, capture learnings second, and give the updated handoff last. Learning-only invocations use the same in-band completion mechanism.
- Schedule each hook at most once per invocation. Re-entering the pre-settle boundary after the continuation does not reschedule consumed hooks. A resume starts a new invocation.
- Keep reflection in the child's normal tracing, usage, compaction, cancellation, and turn-limit path. There is no reflection exemption or separate turn allowance.
- The child stays unfinished until its ordinary session run, including the requested continuation, settles. The full final report describes the final files and latest validation, not a stale pre-review result or the one-line reply used by primary forks.

### Shared notebook ownership and authority

- The primary owns the single notebook for the entire interactive delegation tree. Children do not create separate notebook owners.
- Provide a primary-owned live notebook write bridge. Existing interactive children explicitly lack notebook ownership, and the existing pair staging path alone does not provide immediate child-to-primary commits.
- Eligible children and their pairs can add learnings during ordinary work and during reflection. Primary-owned validation and append operations govern acceptance.
- Child and child-pair contributions are add-only. They cannot supersede or retire shared learnings or perform a full retention sweep. The primary and its pair retain their existing curation authority.
- Commit validated additions immediately. A later child failure or cancellation does not remove already accepted entries.
- Preserve accepted contributions under concurrency, source validation, and the existing session/branch lifecycle. Work belonging to an old owner must not commit into an unrelated current session or branch.
- Keep the notebook's learning contract: discoveries and what to do differently, rather than task status, plans, decisions, or mandatory filler. No worthwhile learning is a valid reflection outcome.

### Evidence and read access

- Retain the original cited child source entries in the primary session archive, with their child origin and source attribution preserved. Retain selected cited evidence, not whole transcripts.
- Validate contributions against actual host-known child evidence. A child entry ID cannot be treated as if it already addressed an entry in the primary session.
- Make `revisit_note` recover the original relevant child conversation, commands, and results, rather than only a parent-stored report. Recall remains available after an ephemeral child is disposed.
- Evidence retention is owned by the primary archive; contributing children need no persistence override. Avoid a second notebook store or a separate copied transcript store.
- Give coding children shared-learning snapshots at launch and after child compaction. Provide explicit fresh notebook reads and exact recall for both children and their pairs.
- Preserve append-only context. Snapshots are appended at the agreed lifecycle boundaries; sharing does not rebuild prior request context or broadcast each sibling update to every active child.

### Failure, ambiguity, and handoff

- If the pre-settle model continuation fails after Pi's normal retries, return an ordinary failed-child outcome. Retain changed files and available report/evidence; do not roll back work or claim reviewed success.
- If a notebook contribution is rejected or cannot be committed while implementation/review otherwise succeed, allow coding delivery and identify the uncaptured learning and reason in the final handoff.
- Respect ordinary cancellation and configured turn ceilings. Report skipped or unfinished reflection honestly where a handoff is available.
- When review exposes unclear intent, use `clarify` if available. If existing parent context cannot settle the question, leave the disputed change alone and identify the unresolved question and affected verification in the handoff. Clarification is advice, not fresh authorization.
- Return the updated full implementation report, including changes, validation outcomes and gaps, review status, and a brief summary of notebook additions. No separate root notification is required solely for these hooks; ordinary interactive-agent result delivery remains in place.

### Production owners

- Evolve the existing change-reflection and learning-reflection behavior, interactive subagent registration/runner/lifecycle, primary notebook mutation and recall, and pair notebook integration at their current responsibility boundaries.
- Reuse existing prompts and behavior where their contract is retained; distinguish primary fork execution from child in-band execution without building a second review engine.
- Update the closest product documentation and high-level execution-context guidance for intentional changes to child reflection, notebook access, and source recall. Current root-only descriptions are the baseline being changed, not an alternative future contract.
- Select internal interfaces and archival representation during implementation to satisfy this specification. No exact new tool name, storage schema, queue abstraction, or ordinary module layout was settled in the interview.

## Testing Decisions

### Confirmed seam

The operator confirmed one highest-useful observable integration seam: real Pi SDK primary/child sessions with scripted models, testing interactive-agent handoff and shared-notebook behavior together. Use temporary workspace, session, and configuration state. Existing reflection and pair suites provide regression coverage.

Exercise public interactive-agent execution/result/stop behavior and registered notebook operations rather than mock pre-settle completion or assert private state-machine fields. Scripted model replies make timing, tool calls, failures, and evidence deterministic without requiring a network model.

A later TDD invocation must obtain its own fresh seam confirmation before writing or editing tests.

### What good tests prove

- An eligible child's result remains pending while its pre-settle continuation is running, then returns a report and artifact reflecting the review's final edits and validation.
- Eligibility follows active built-in capability, including custom coding agents; `pair: false` does not disable hooks. Ineligible advisory/internal sessions retain their existing scope.
- Successful built-in edits/writes trigger change review; unsuccessful calls and no-edit invocations do not. Learning reflection still runs at every eligible completion.
- A combined continuation performs the due activities without a mandatory separate learning request. Review edits do not cause another review, and a resumed invocation receives a new one-pass completion phase.
- Child and child-pair additions reach the primary notebook while work is ongoing. Attempts to supersede, retire, or perform full maintenance through child authority cannot alter existing conclusions.
- Concurrent and nested contributions reach the same primary owner without losing accepted updates or crossing unrelated session/branch ownership.
- Exact recall returns the cited original child evidence and provenance after an ephemeral child is disposed. Uncited transcript material is not copied as part of evidence retention.
- Launch and post-compaction snapshots expose shared learnings; explicit reads expose fresh state; ordinary requests retain their historical prefix rather than rebuild earlier messages.
- Accepted learnings remain after subsequent failure or cancellation. Stopping, navigation, shutdown, and configured turn ceilings also govern reflection work.
- A failed model continuation is not returned as reviewed success. A recoverable notebook capture gap is visible without automatically failing successful coding work.
- Unresolved intent follows available clarification and remains explicit in the final report, without an unauthorized rewrite of the disputed behavior.
- The full handoff includes supported validation claims and hook outcomes without an extra hook-specific root notification.
- Primary automatic reflections retain their passive-fork behavior and existing cadence. Pi Exec worker behavior remains outside this change.

### Prior art and regression coverage

- [Real SDK child-runner integration](../../components/subagents/tests/subagent-runner-e2e.test.ts): real `AgentSession`, scripted provider responses, temporary state, tool scope, and persistence.
- [Child clarification integration](../../components/subagents/tests/subagent-clarify.test.ts): parent ownership, independent sessions, cancellation, and source-bearing context.
- [Change-reflection behavior](../../components/change-reflection/tests/change-reflection.test.ts): tracked edits, review lenses, post-change execution evidence, primary passive forks, and suppression of repeated reflection.
- [Learning-reflection behavior](../../components/notebook/tests/learning-reflection.test.ts): journaling, failed/surprising evidence, and the unchanged primary spacing policy.
- [Notebook mutation behavior](../../components/notebook/tests/notebook-maintenance.test.ts) and [exact recall](../../components/notebook/tests/recall-tool.test.ts): validation, notebook authority, and sourced retrieval.
- [Pair offline harness](../../components/pair-programmer/tests/pair.test.mjs): pair lifecycle and notebook integration without an implicit network dependency.

These are precedents, not permission to keep tests that assert the superseded root-only child notebook boundary. Adapt executable expectations to the intentional new contract while retaining coverage of read-only/internal sessions and excluded workers.

Run the cheapest falsifying behavioral check during implementation, then relevant component/integration suites, typecheck, package loading, and packaging inspection before claiming completion. Use the repository's normal format/lint checks without blanket formatting of unrelated dirty work. Validate real request-prefix behavior after context changes using the existing cache audit; scripted SDK tests alone do not prove provider cache performance.

## Out of Scope

- Pi Exec model-worker reflection, notebook behavior, process shutdown, or structured-output changes.
- Changes to primary automatic reflection triggers, learning cadence, passive-fork execution, `/reflect`, or `/distill` behavior.
- A second review engine, a separate child notebook owner, or a second notebook/transcript store.
- New hook opt-out settings, invocation parameters, reflection turn exemptions, or separate reflection allowances.
- Detection of shell, MCP, or other mutations beyond the existing successful built-in edit/write tracker.
- Automatic placement into documentation, the wiki, task retrospectives, skills, or other durable owners.
- Child authority to retire, supersede, or fully maintain the shared notebook.
- Sibling-update fan-out, request-context rewriting, or a general pair-programmer redesign beyond the agreed shared-notebook access and add-only contribution.
- Implementation, ticket generation, commits, publication, deployment, or external issue creation as part of this specification step.

## Further Notes

### Decision provenance

This specification records the operator-confirmed design from the current conversation. The design was confirmed after four decision rounds. The operator then authorized creation of this task bundle and confirmed the integration test seam before this specification was written.

The primary/child execution split is deliberate: primary automatic work stays passive, whereas child reflection is part of the completion contract. Pairing, reflection execution, and notebook ownership are separate responsibilities.

### Governing and supporting sources

- [Subagent product contract](../../docs/subagents.md): interactive-child lifecycle, pairing defaults, tool scope, ownership, resumes, and result delivery. Its current child notebook exclusion is intentionally extended by this design.
- [Change-review product contract](../../docs/change-reflection.md): lenses, successful edit/write tracking, validation evidence, completed-run trigger, and primary passive behavior. Its root-only scope is intentionally extended for eligible interactive children.
- [Context and notebook product contract](../../docs/context.md): learning vocabulary, primary spacing, notebook authority, exact citations, archive ownership, and append-only compaction packets. Child participation is the intentional extension specified here.
- [Forked-continuation product contract](../../docs/forked-continuations.md): the unchanged primary mechanism and why a detached fork is not the chosen child completion mechanism.
- [Development conventions](../../docs/development.md) and [repository operating guide](../../AGENTS.md): module ownership, runtime capability guidance, package boundaries, validation, and preservation of unrelated work.
- [Domain language](../../.wiki/pages/domain-language.md): supporting vocabulary for primary/root sessions, interactive children, Pi Exec workers, learnings, and notebook recall. The wiki supports rather than replaces product authority.
- [Pi request internals](../../.wiki/pages/pi-request-internals.md): supporting implementation context for projections and passive forks; not the product authority for the child design.

Pi's installed boundary API and run loop were inspected during the investigation: `agent_before_settle` can append entries and request a continuation, and `session.prompt()` remains awaited through that continuation. The boundary runs again before final settlement, which requires the per-invocation guards specified above.

### Remaining hand-offs and evidence limits

There is no unresolved product decision blocking this specification. The primary-owned live write bridge, cited-evidence archival representation, and child/pair read delivery still need implementation and behavioral verification at the confirmed seam.

Before this specification step, 28 existing change-reflection, learning-reflection, and fork-helper tests passed. They prove existing primitives only, not the proposed child integration. No new tests or implementation were written during specification authoring.

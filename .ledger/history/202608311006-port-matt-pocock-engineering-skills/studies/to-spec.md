# `to-spec` fidelity study

Sources: `mattpocock/skills` at `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`

- `skills/engineering/to-spec/SKILL.md`
- `docs/engineering/to-spec.md`
- downstream `skills/engineering/to-tickets/SKILL.md`
- downstream `skills/engineering/implement/SKILL.md`

Status: approved; implementation and validation complete

## Role in the workflow

`to-spec` is an explicit human-invoked synthesis step for work that is already decided but must survive several sessions or fresh-context hand-offs. Small work that fits one context should move from design directly to implementation. It is not a generic planning ritual.

The spec is the stable statement of the destination and settled decisions. Downstream tickets are disposable execution slices. The spec is a snapshot rather than a document kept continuously synchronized with implementation.

## Upstream doctrine to preserve

1. Keep `disable-model-invocation: true`.
2. Synthesize the current conversation, repository facts, domain language, and governing decisions. Do not reopen the design or invent content to fill a section.
3. Explore the repository before writing when current implementation facts, test precedent, or vocabulary are not already known.
4. Sketch the fewest, highest useful observable test seams, preferring existing seams and ideally one. Present them to the operator, then stop and wait for confirmation before writing the spec.
5. Treat seam confirmation as the one bounded interaction, not a new design interview. If a substantive product or architecture decision is still open, stop and return the work to `/skill:interrogate-to-design` rather than conducting a smaller interview inside `to-spec`.
6. Preserve the upstream sections: Problem Statement, Solution, User Stories, Implementation Decisions, Testing Decisions, Out of Scope, and Further Notes.
7. Keep ordinary implementation file paths and code snippets out because they decay. A compact prototype-derived state machine, reducer, schema, or type shape may be included when it records a decision more precisely than prose; identify its prototype source.
8. Write only the specification. Ticketing, implementation, review, commits, and publication remain separate actions.

## Seam relationship to Apple Pi TDD

The `to-spec` seam checkpoint records the intended testing architecture of the work. It does not pre-authorize later test mutation. Apple Pi's approved TDD contract still requires fresh seam confirmation on every invocation before a test is written. The two gates answer different questions at different times and both remain.

## Artifact and authority translation

Upstream requires a configured issue tracker and publishes one labelled issue. Apple Pi has no global tracker contract.

Target resolution:

1. Use an explicit destination supplied by the operator.
2. Otherwise inspect `.ledger/INDEX.md` and candidate live `task.md` files. Write `spec.md` only in a bundle whose intent and current state clearly govern the undertaking; one live row alone does not establish ownership.
3. If no bundle governs the work or ownership is ambiguous, ask the operator to select or create a task, supply another destination, or stop. Combine this choice with the seam-confirmation checkpoint when possible. Use `ledger_add` only after explicit approval and never invent a detached spec.

Repository instructions remain authoritative for the spec's required content and format. An external destination still requires an explicit operator target or other unambiguous publication authority; a documented tracker convention alone does not trigger publication.

Explicit `/skill:to-spec` invocation authorizes the bounded local spec write after seam confirmation. It does not independently authorize remote issue creation, triage labels, commits, ticket generation, implementation, or other external effects. Project instructions or an explicit operator request may authorize an external destination.

The ledger remains an open-ended task container; this skill owns only its spec format. The skill creates no tracker registry, task catalog, version database, or synchronization mechanism.

## Context and authority

Read relevant domain-language and design pages from `.wiki/` as supporting context. Respect authoritative ADRs, repository documentation, tests, and maintainer instructions. Link relevant ADRs, repository documentation, wiki pages, source specifications, and prototype evidence where they support a decision rather than copying them into a competing authority. Wiki links remain supporting context rather than authority.

Repository exploration establishes facts; it does not settle missing decisions. Contradictions between the conversation, code, tests, ADRs, or project instructions block synthesis until the operator resolves them through the appropriate design workflow.

The root should perform the synthesis because the current conversation is the primary source the workflow exists to preserve. Read-only exploration may be delegated only when factual discovery is genuinely independent; the root remains responsible for the spec.

## Upstream template

```markdown
## Problem Statement

The problem from the user's perspective.

## Solution

The solution from the user's perspective.

## User Stories

A numbered list in the form: As an <actor>, I want <feature>, so that <benefit>.

## Implementation Decisions

Settled modules, interfaces, technical clarifications, architectural decisions, schema changes, API contracts, and interactions, without ordinary implementation paths or snippets.

## Testing Decisions

Observable behavior, agreed seams, relevant modules, and repository test precedent.

## Out of Scope

The deliberately excluded work.

## Further Notes

Other settled context needed by a fresh reader.
```

Upstream calls for a **LONG**, **extremely extensive** user-story list. Preserve that requirement literally for features, refactors, and architectural work despite the fit limitation acknowledged in upstream documentation. The general no-invention rule still applies: every story must express the already-settled design rather than adding a new decision.

## Snapshot lifecycle

The completed spec records the understanding at synthesis time. It is not silently rewritten as implementation progresses. Durable implementation learning belongs in authoritative documentation, qualified ADRs, curated wiki knowledge, or the task retrospective.

Upstream defines no material-redesign procedure beyond treating the spec as a snapshot that eventually goes stale. Ideally the interview prevents this case. If a material redesign does occur, return to interrogation, settle the pivot completely, and regenerate or amend the same task-local `spec.md` in place. Treat affected tickets as stale and regenerate them through `to-tickets` before implementation resumes. Keep the task bundle cognitively consistent and pointed in one direction rather than retaining superseded specifications or an internal version chain.

Once the task is complete, the operator may choose to promote the settled specification into an authoritative repository location and commit it. Git then owns its durable version history. Promotion and commit remain separately authorized actions.

## Completion report

Report the spec destination, confirmed seams, unresolved factual blockers, and whether the result is ready for `to-tickets`. After an in-place redesign, identify existing affected tickets as stale and require regeneration before implementation resumes. Do not start ticketing or implementation automatically.

## Proposed package shape

- `skills/to-spec/SKILL.md` only; no runtime mechanism or supporting reference is presently justified.
- Human-only loader visibility.
- README, provenance, adopted-boundary, loader, and Pi Exec discovery reconciliation.
- Proportional loader/package checks rather than a prose behavior harness.

## Validation

- The real skill loader discovers `to-spec` with no diagnostics and human-only invocation; Pi Exec skill discovery excludes it.
- The package dry run contains `skills/to-spec/SKILL.md`.
- Validation passed the 80-test focused runtime suite, the 916-test unit suite, typecheck, loader validation, formatting, focused lint, package inclusion, and scoped diff checks.
- No tracker bridge, spec registry, revision system, runtime mechanism, or prose behavior harness was added.

## Resolved operator decisions

1. **User stories** — preserve upstream's long, extremely extensive user-story requirement literally, including for refactors and architectural work.
2. **Governing-source links** — include stable ADR, repository-documentation, wiki, source-specification, and prototype links where they support decisions; preserve authority distinctions.
3. **Default local destination** — use `.ledger/<task>/spec.md` unless the operator explicitly supplies another destination. Repository tracker conventions do not silently redirect the artifact.
4. **Material redesign** — upstream has no redesign mechanism. Return to interrogation, settle the pivot, mutate the same task-local spec in place, and regenerate affected tickets before implementation resumes. Retain one coherent active trajectory; durable post-task promotion relies on explicit operator authority and Git history.

---
name: to-spec
description: "Turn settled conversation and codebase understanding into a task-local specification for work that must cross sessions: no design interview, just synthesis."
disable-model-invocation: true
---

# To Spec

Turn the current conversation context and codebase understanding into a specification. Do **not** interview the user; synthesize only what is already settled. This step is for decided work that must survive several sessions or fresh-context hand-offs. Work that fits one context can move directly to `/skill:implement`.

If a substantive product or architecture decision is still open, stop and return to `/skill:interrogate-to-design`. Repository exploration can establish facts, but it cannot settle missing decisions or resolve contradictions between the conversation and governing project authority.

## Process

### 1. Resolve the destination and context

Use a destination explicitly supplied by the user. Otherwise inspect `.ledger/INDEX.md` and the candidate live `task.md` files. Use `spec.md` only in a bundle whose intent and current state clearly govern this undertaking; one live ledger row alone does not establish ownership. If no bundle governs the work or ownership is ambiguous, ask the user to select or create a task, supply another destination, or stop. When possible, combine that destination choice with the test-seam checkpoint below. Call `ledger_add` only after explicit approval, and never invent a detached specification path.

This invocation authorizes the bounded local specification write after seam confirmation. It does not authorize remote issue creation, triage labels, commits, ticket generation, implementation, publication, or other external effects. A documented issue-tracker convention does not silently redirect the artifact; an external destination requires explicit authority.

Explore the repository if its current implementation, test precedent, or vocabulary is not already known. Read relevant code, tests, task artifacts, domain-language and design pages in `.wiki/`, ADRs, repository documentation, and maintainer instructions. Use the project's domain vocabulary throughout. Treat wiki pages as supporting context and repository documentation, tests, ADRs, and maintainer instructions according to their established authority.

Link stable governing sources where they support a decision: relevant ADRs, repository documentation, wiki pages, source specifications, and prototype evidence. Preserve their authority distinctions rather than copying them into a competing source of truth.

### 2. Confirm test seams

Sketch the seams at which the feature will be tested. Prefer existing seams to new ones and use the highest useful observable seam. The fewer seams across the change, the better; the ideal number is one. If a new seam is needed, propose it at the highest point you can.

Present the proposed seams to the user, then **stop and wait for confirmation** before writing the specification. This is the one bounded confirmation in `to-spec`, not a new design interview.

Record the confirmed seams in the specification. A later TDD invocation still requires its own fresh seam confirmation before writing or editing tests.

### 3. Write the specification

Write the specification at the resolved destination using the template below. Every assertion must come from the settled conversation, repository facts, or a cited governing source. Missing material blocks the specification; never invent a decision to fill a section.

<spec-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A **LONG**, numbered list of user stories. Each user story must use this format:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see the balance on my accounts, so that I can make better informed decisions about my spending.
</user-story-example>

This list must be extremely extensive and cover all aspects of the feature. Preserve this requirement for refactors and architectural work as well; express only the already-settled design rather than inventing new actors, benefits, or decisions.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built or modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do **not** include ordinary implementation file paths or code snippets. They may become outdated quickly.

Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can—a state machine, reducer, schema, or type shape—inline it within the relevant decision and note briefly that it came from a prototype. Trim it to the decision-rich parts rather than including a working demo.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test: test external behavior rather than implementation details
- Which modules will be tested
- Prior art for the tests, such as similar tests in the codebase
- The confirmed test seams

## Out of Scope

A description of the things that are out of scope for this specification.

## Further Notes

Any further settled context needed by a fresh reader. Put stable governing-source links here when they do not belong beside a specific decision.

</spec-template>

### 4. Report the result

Report:

- the specification path;
- the confirmed seams;
- any unresolved factual blockers; and
- whether the specification is ready for `/skill:to-tickets`.

Do not start ticketing or implementation automatically.

## Material redesign

The specification is a current task snapshot, not a document kept continuously synchronized with implementation. If a material design pivot occurs, return to `/skill:interrogate-to-design`, resolve the new design completely, then regenerate or amend the same task-local `spec.md` in place. Treat affected existing tickets as stale and regenerate them through `/skill:to-tickets` before implementation resumes. Keep the task bundle pointed in one coherent direction rather than retaining superseded specifications or an internal version chain.

Once the task is complete, the user may choose to promote the settled specification into an authoritative repository location and commit it. Promotion and commit remain separately authorized; Git then owns durable version history.

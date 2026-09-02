# Interrogate and Interrogate to Design

Sources: `mattpocock/skills` at `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`

- `skills/productivity/grilling/SKILL.md`
- `skills/engineering/grill-with-docs/SKILL.md`
- `skills/engineering/domain-modeling/SKILL.md`

Status: approved; implementation and validation complete

## Target

Provide two explicit surfaces without introducing a `grilling` skill or invocation mechanism:

1. `/interrogate [subject]` expands a small prompt that conducts the upstream dependency-ordered interview without writing documentation.
2. `/skill:interrogate-to-design` is a human-only skill that embeds the same interview language and captures resolved domain language, approved ADRs, and broader reusable design synthesis as the discussion progresses.

The few lines of interview language are copied directly into both files. There is no shared reference, generated block, synchronization test, invocation bridge, or other maintenance machinery.

## Interview contract to preserve

- Map the subject as a design tree: every decision branches into the decisions that depend on it.
- Work in rounds. The frontier is every decision whose prerequisites are settled now.
- Ask the whole current frontier in one numbered round and give a recommended answer for every question, then stop and wait for the operator's answers before starting the next round.
- Put a dependent question in a later round rather than asking the operator to answer through an unresolved prerequisite.
- Facts are the agent's job. Use local tools or a suitable read-only Explorer/Researcher when needed; continue asking independent frontier questions while that evidence is pending.
- Decisions are the operator's job. Never answer the operator's side of the interview.
- Recompute the design tree and frontier after every response.
- Finish only when the in-scope frontier is empty, then wait for explicit confirmation that shared understanding has been reached before implementing or handing the result to another workflow.
- Use no question limit or "clear enough" heuristic.

## Scope and escape hatches

Establish the subject and scope before expanding the tree. A branch beyond that scope is named as an explicit hand-off rather than silently ignored. If a decision requires empirical evidence, pause that branch and propose a research or prototype step; continue with independent frontier branches. Changing the scope reopens the tree.

## `/interrogate`

`prompts/interrogate.md` is a normal Pi prompt template with optional subject arguments. It contains only the interview contract and the chosen subject. It creates no files and takes no downstream action before the final shared-understanding confirmation.

This is an explicit slash command, not a model-visible skill.

## `/skill:interrogate-to-design`

The skill retains `disable-model-invocation: true`. Explicit invocation authorizes bounded `.wiki/` curation for the interview's subject, including the minimal wiki initialization needed when the first durable knowledge emerges. It does not authorize implementation, commits, publication, external effects, or an ADR without separate approval.

As decisions crystallize:

- update resolved domain terms inline, preserving pure glossary pages without implementation details;
- file broader reusable design knowledge only when it has cross-task value, integrating it with existing pages rather than dumping the transcript;
- preserve provenance, uncertainty, disagreement, and source authority;
- keep task-specific execution context, specifications, tickets, and plans out of the wiki and in their established repository or ledger owners;
- offer an ADR only when the decision is hard to reverse, surprising without context, and the result of a real trade-off, then obtain approval before creating or editing it;
- update wiki knowledge first, navigation only when changed, run `wiki_lint`, repair only introduced findings, and append `.wiki/LOG.md` only after the mutation is coherent.

Inline documentation is part of this workflow. The final no-action gate prevents implementing the design or launching the next workflow before the frontier is empty and shared understanding is confirmed.

## Apple Pi translations and approved deviations

| Change | Classification | Reason |
| --- | --- | --- |
| Rename `grilling` to `interrogate` and `grill-with-docs` to `interrogate-to-design` | Operator-approved naming | Uses direct language that fits the harness. |
| Split the generic interview into a prompt template | Platform translation | Pi prompt templates provide the desired explicit slash-command expansion without another skill surface. |
| Embed the interview contract directly | Platform translation | Pi has no model-callable Skill tool; the source wrapper cannot execute literally. |
| Use `.wiki/` instead of root `CONTEXT.md` | Platform translation | The wiki is Apple Pi's reusable LLM-knowledge owner. |
| Capture broader reusable wiki synthesis | Operator-approved addition | The documenting interview owns more than glossary terms while retaining wiki curation boundaries. |
| Use explicit scope, hand-off, research, and prototype branches | Policy clarification | Prevents runaway scope without weakening the empty-frontier completion invariant. |

## Implementation scope

- Add `prompts/interrogate.md`.
- Add `skills/interrogate-to-design/SKILL.md` with no supporting files.
- Update the README catalog, Matt Pocock provenance, adopted boundary, real prompt/skill loader assertions, and Pi Exec skill discovery checks.
- Extend the existing loader/runtime checks for prompt expansion and human-only skill visibility; inspect the English directly rather than building a behavior or synchronization harness around it.
- Keep the copied English ordinary. Add no synchronization or generation machinery.

## Acceptance

A fresh model in an unknown repository can conduct the generic interview from `/interrogate`; the documenting skill is available only through explicit `/skill:interrogate-to-design`; both preserve rounds, dependency frontier, recommendations, agent-owned fact finding, operator-owned decisions, empty-frontier completion, and explicit confirmation; the documenting skill curates reusable wiki knowledge without turning the wiki into a transcript or spec store; and loader, package, focused validation, formatting, and diff checks pass.

## Validation

- The real prompt loader discovers `/interrogate`, expands its default and supplied subject, and retains the design-tree, empty-frontier, and no-write boundaries.
- The real skill loader discovers `interrogate-to-design` with no diagnostics and human-only invocation; Pi Exec skill discovery excludes it.
- The package dry run contains `prompts/interrogate.md` and `skills/interrogate-to-design/SKILL.md`.
- Validation passed the 80-test focused runtime suite, the 916-test unit suite, typecheck, loader validation, formatting, focused lint, package inclusion, and scoped diff checks.
- No shared reference, generated block, synchronization test, or separate behavior harness was added.

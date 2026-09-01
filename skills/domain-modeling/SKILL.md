---
name: domain-modeling
description: Build and sharpen a project's domain model. Use when discussing codebase terminology, writing or editing domain-language pages in `.wiki/`, defining bounded contexts, or recording or editing an ADR.
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design. This is the *active* discipline: challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallise. (Merely *reading* the domain-language pages for vocabulary is not this skill: that's a one-line habit any skill can do. This skill is for when you're changing the model, not just consuming it.)

## File structure

Most repos have a single context:

```text
/
├── .wiki/
│   └── pages/
│       └── domain-language.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

Read `.wiki/README.md` for a local context-map convention first. If it names a context-map page, use that page. Otherwise, the presence of the default `domain-contexts.md` page means the repo has multiple contexts. The map points to each context's domain-language page and records how the contexts relate:

```text
/
├── .wiki/
│   └── pages/
│       ├── domain-contexts.md
│       ├── ordering-language.md
│       └── billing-language.md
├── docs/
│   └── adr/                          ← system-wide decisions
└── src/
    ├── ordering/
    │   └── docs/adr/                 ← context-specific decisions
    └── billing/
        └── docs/adr/
```

Follow established local wiki and ADR conventions when they exist. Otherwise use the defaults above. Wiki page filename stems must remain globally unique and case-insensitive.

Create files lazily: only when you have something to write. If no domain-language page exists, create one when the first term is resolved. If no ADR directory exists, create it when the first ADR is approved.

An active domain-modeling request that reaches its first resolved term is sufficient authority for the bounded `.wiki/` initialization needed to record it. Follow the [`llm-wiki` initialization procedure](../llm-wiki/references/initialize.md) directly; do not stop to ask separately whether to initialize.

Before changing the glossary, orient from `.wiki/README.md`, `.wiki/INDEX.md`, relevant recent `.wiki/LOG.md` entries, existing domain-language pages, and nearby graph context when it matters. Treat wiki content as supporting context and check it against project authority and code.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in the domain glossary, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account': do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible. Which is right?"

### Update the domain glossary inline

When a term is resolved, update its domain-language page right there. Don't batch these up: capture them as they happen. Use the format in [DOMAIN-LANGUAGE-FORMAT.md](references/DOMAIN-LANGUAGE-FORMAT.md).

Keep each wiki mutation coherent. Update the glossary first and navigation only when navigation changed. Run `wiki_lint`, repair only findings introduced by this mutation, and report pre-existing findings without broadening the edit. Append `.wiki/LOG.md` only after the intended state is coherent; name the resolved term, source, subject, or repair and every affected knowledge page. A failed or no-op update does not receive a completed-mutation log entry. Use the [`llm-wiki` maintenance procedure](../llm-wiki/references/maintain.md) for renames, moves, merges, or broader reorganization.

Domain-language pages should be totally devoid of implementation details. Do not treat them as specs, scratch pads, or repositories for implementation decisions. They are glossaries and nothing else.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse**: the cost of changing your mind later is meaningful
2. **Surprising without context**: a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the repository's existing authoritative ADR convention. If none exists, preserve decision scope using the defaults above and the format in [ADR-FORMAT.md](references/ADR-FORMAT.md). Explain why the decision qualifies and get the user's approval before creating or editing the ADR. Wiki pages may link to an ADR, but do not duplicate or replace it.

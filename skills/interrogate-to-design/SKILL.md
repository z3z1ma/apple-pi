---
name: interrogate-to-design
description: "Interrogate a plan, decision, or idea and capture the resulting domain language, reusable design knowledge, and approved ADRs as understanding develops."
disable-model-invocation: true
---

# Interrogate to Design

Interrogate the user about the plan, decision, or idea they supplied while turning settled knowledge into durable project context.

Map the subject as a **design tree**: every decision branches into the decisions that depend on it. Establish the scope, then work the tree in rounds. The **frontier** is every in-scope decision whose prerequisites are settled now. Ask the whole frontier in one numbered round and give your recommended answer for every question. Put questions with unresolved prerequisites in a later round. Then stop and wait for the user's answers before starting the next round.

Facts are your job: use available tools or suitable read-only agents instead of asking the user for information you can establish yourself. If fact-finding or a prototype is still running, leave only its dependent branch unsettled and continue with the rest of the frontier. Decisions are the user's job: never answer their side of the interview.

After each response, recompute the tree and frontier. Name out-of-scope branches and empirical questions that need a separate research, prototype, or hand-off step. Use no question cap and no "clear enough" shortcut.

The interview is complete only when the in-scope frontier is empty. Then summarize the shared understanding, remaining hand-offs, and scope boundary, and wait for the user's explicit confirmation. Documentation described below happens as knowledge crystallizes; implementation and downstream workflows wait for that final confirmation.

## Capture durable knowledge inline

Explicit invocation authorizes bounded `.wiki/` curation for this interview's subject. If the wiki is absent when the first durable knowledge emerges, follow the [initialization procedure](../llm-wiki/references/initialize.md). Before other wiki writes, orient from its README, index, recent relevant log, existing pages, and nearby references when useful.

As decisions settle:

- Update resolved domain terms in the relevant domain-language page. Keep glossary entries free of implementation details, specifications, and scratch notes; follow the [domain-language format](../domain-modeling/references/DOMAIN-LANGUAGE-FORMAT.md).
- Integrate broader reusable design knowledge into existing wiki pages when that is clearer. Create a page only for a distinct durable subject with cross-task value. Synthesize the decisions and evidence rather than copying the conversation.
- Preserve provenance, uncertainty, disagreement, and source authority. Repository documentation, tests, ADRs, and maintainer instructions remain authoritative.
- Keep task-specific implementation context, specifications, tickets, and plans in their established repository or ledger owners rather than the wiki.
- Offer an ADR only when the decision is hard to reverse, surprising without context, and the result of a real trade-off. Explain why it qualifies and get approval before creating or editing it; follow the repository convention or the [ADR format](../domain-modeling/references/ADR-FORMAT.md).

For each coherent wiki mutation, update knowledge first and navigation only when navigation changed. Run `wiki_lint`, repair only findings introduced by the mutation, and append `.wiki/LOG.md` only after the intended state is coherent. Follow the relevant `llm-wiki` procedure for initialization, ingestion, or broader maintenance.

Do not turn the wiki into a transcript, implementation specification, or competing source of truth. Invocation does not authorize commits, publication, deployment, external effects, or implementation of the resulting design.

## Finish

After the user confirms shared understanding, report:

- the settled design and scope;
- the durable knowledge and ADR paths changed;
- unresolved research, prototype, or hand-off branches; and
- the next appropriate workflow, if the user asks to continue.

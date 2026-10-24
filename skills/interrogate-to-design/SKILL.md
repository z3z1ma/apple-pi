---
name: interrogate-to-design
description: "Interrogate a plan, decision, or idea and capture the resulting domain language, reusable design knowledge, and approved ADRs as understanding develops."
disable-model-invocation: true
---

# Interrogate to Design

Interrogate the operator about the plan, decision, or idea they supplied, and turn settled knowledge into durable project context as it settles.

## The interview

Map the subject as a **design tree**: every decision branches into the decisions that depend on it. Establish the scope, then work the tree in rounds. The **frontier** is every in-scope decision whose prerequisites are settled now. Ask the whole frontier in each round, with your recommended answer for every question, and put questions with unresolved prerequisites in a later round. Then wait for the answers.

Ask each round with `ask_user_question`: put what you found and why it matters in your message, and ask the questions as short structured choices, four per call, with as many calls as the frontier needs. Use prose only for a question whose answer does not fit a few options.

Facts are your job: use tools, interns, or people in the organization (such as a standing `repository-archaeologist` for this codebase) instead of asking the operator for what can be established. If fact-finding is still running, leave only its dependent branch open and continue with the rest. Decisions are the operator's: never answer their side.

After each round, recompute the tree and frontier. Name out-of-scope branches and empirical questions that need research, a prototype, or a hand-off. Use no question cap and no "clear enough" shortcut.

The interview is complete only when the in-scope frontier is empty. Before you present the summary, give it to a colleague in the organization with the right lens (for example `vp-of-product` for what to build, `chief-architect` for system shape; call in one who has worked with you before, or hire one), without the conversation, and ask which branch is missing; open a new round for any real gap. Then summarize the shared understanding, remaining hand-offs, and scope boundary, and wait for explicit confirmation. Implementation and downstream workflows wait for that confirmation.

## Capture knowledge as it settles

Starting this skill authorizes bounded `.wiki/` curation for this subject. Make each wiki change by the [`llm-wiki`](../llm-wiki/SKILL.md) procedures, including initialization when the wiki is absent.

- Record resolved domain terms in the domain-language page, in the [domain-language format](../domain-modeling/references/DOMAIN-LANGUAGE-FORMAT.md), free of implementation detail.
- Fold broader reusable design knowledge into existing pages, and create a page only for a distinct subject with value beyond this task. Synthesize; never copy the conversation.
- Keep task-specific specifications, tickets, and plans in their ledger or repository owners.
- Offer an ADR only when the decision is hard to reverse, surprising without context, and the result of a real trade-off. Say why it qualifies and get approval before writing it, following the repository's convention or the [ADR format](../domain-modeling/references/ADR-FORMAT.md).

This skill authorizes no commits, publication, deployment, or implementation.

## Finish

After the operator confirms, report the settled design and scope, the wiki pages and ADRs changed, the open research, prototype, or hand-off branches, and the next workflow if they want to continue (for example `/skill:to-spec`).

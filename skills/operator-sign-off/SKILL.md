---
name: operator-sign-off
description: "Ask the operator to judge, approve, or decide in the browser: a code change (`review_code`), a document (`review_markdown`), or a ledger task (`review_ledger_task`). Use whenever work needs the operator's judgment before it continues, and when the operator asks to inspect, review, or sign off."
---

# Operator sign-off

A sign-off is the point where the operator decides. The page shows the truth from git and disk; you make the judgment easy to reach. Raw model prose fails here in predictable ways: too dense, assuming context the operator never had, burying the ask. Present the way people actually take in information.

**Goal:** the operator knows what they are deciding, can decide from the page alone in the time they have, and the next action follows their verdict.

## Present for a human

- **Open when the material is ready.** Everything the judgment needs is on the page; a half-ready page costs a second review.
- **Orient in the conversation first.** One or two sentences: what it is, what changed since the operator last saw it, and what you need. Put the ask in `note` in one sentence when it sharpens what to read for; a note that repeats the title is noise.
- **Answer first.** The page opens with the decision you need and your recommendation, then a picture of the idea, then the support. The operator can stop reading at any point and still know the ask.
- **Respect working memory.** A few items per level. Disclose progressively: the summary, then the structure, then detail for whoever wants it.
- **Picture and words together.** Show a flow, a state change, or a structure as a picture before the prose. When the subject is cases, a table of inputs and results beats both.
- **Concrete before abstract.** One worked example with toy data, then the rule.
- **Name the context you assume.** The operator was not in your conversation. Say what they need to know, once, where they need it.
- **Cut what does not bear on the judgment.** Every extra line spends the operator's attention.
- **Plain technical English.** Short sentences, one idea each, active voice, one word per meaning.
- **Honest confidence.** Say what was proven, what was not, and what is a guess. Unverified is a legitimate status; hiding it is not.

## Test it on a cold reader

Before the page opens, give a `new-team-member` (call in one who has read for you before; hire one when none exists) only the material and the repository, never the conversation. The material is what the operator will see: your framing drafted in the task's directory for a code change, the document itself, or the task bundle's path. Ask what the operator is being asked to decide, in one sentence, and where it lost them. Revise until the sentence matches your ask and nothing lost them. A small, self-evident sign-off can skip this; say so when you do.

## The sign-off types

Read the reference for the type and follow it:

- [A code change](references/code.md): the operator judges whether a change is right and safe to build on, with `review_code`.
- [A document](references/document.md): the operator decides on what a spec, plan, proposal, or README says, with `review_markdown`.
- [A ledger task](references/ledger-task.md): the operator approves a plan and its tickets, or confirms an outcome, with `review_ledger_task`.

## After the verdict

Apply the comments, rewrites, and decision answers yourself; they are feedback, not edits already made. An approval covers only what the operator saw: treat unread documents, unseen hunks, and graph warnings as limits. Resolve a material question before work that depends on the approval continues. Report what you changed, and what you left and why.

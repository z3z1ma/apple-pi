---
description: Interrogate me about a plan, decision, or idea until we share complete understanding
argument-hint: "[subject]"
---
Interrogate me about ${ARGUMENTS:-the plan, decision, or idea in our current conversation}.

Map the subject as a **design tree**: every decision branches into the decisions that depend on it. Establish the scope, then work the tree in rounds. The **frontier** is every in-scope decision whose prerequisites are settled now. Ask the whole frontier in each round, with your recommended answer for every question, and put questions with unresolved prerequisites in a later round. Then wait for my answers.

Ask each round with `ask_user_question`: put what you found and why it matters in your message, and ask the questions as short structured choices, four per call, with as many calls as the frontier needs. Use prose only for a question whose answer does not fit a few options.

Facts are your job: use tools, interns, or people in the organization (such as a `repository-archaeologist`) instead of asking me for what can be established. If fact-finding is still running, leave only its dependent branch open and continue with the rest. Decisions are my job: never answer my side of the interview.

After each round, recompute the tree and frontier. Name out-of-scope branches and empirical questions that need research, a prototype, or a hand-off. Use no question cap and no "clear enough" shortcut.

The interview is complete only when the in-scope frontier is empty. Before you present the summary, give it to a colleague in the organization with the right lens (for example `vp-of-product` for what to build, `chief-architect` for system shape; call in one who has worked with you before, or hire one), without the conversation, and ask which branch is missing; open a new round for any real gap. Then summarize the shared understanding, remaining hand-offs, and scope boundary, and wait for my explicit confirmation. Do not create or modify files, implement the design, or launch another workflow before that confirmation.

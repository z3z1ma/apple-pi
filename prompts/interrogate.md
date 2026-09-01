---
description: Interrogate me about a plan, decision, or idea until we share complete understanding
argument-hint: "[subject]"
---
Interrogate me about ${ARGUMENTS:-the plan, decision, or idea in our current conversation}.

Map the subject as a **design tree**: every decision branches into the decisions that depend on it. Establish the scope, then work the tree in rounds. The **frontier** is every in-scope decision whose prerequisites are settled now. Ask the whole frontier in one numbered round and give your recommended answer for every question. Put questions with unresolved prerequisites in a later round. Then stop and wait for my answers before starting the next round.

Facts are your job: use available tools or suitable read-only agents instead of asking me for information you can establish yourself. If fact-finding or a prototype is still running, leave only its dependent branch unsettled and continue with the rest of the frontier. Decisions are my job: never answer my side of the interview.

After each response, recompute the tree and frontier. Name out-of-scope branches and empirical questions that need a separate research, prototype, or hand-off step. Use no question cap and no "clear enough" shortcut.

The interview is complete only when the in-scope frontier is empty. Then summarize the shared understanding, remaining hand-offs, and scope boundary, and wait for my explicit confirmation. Do not create or modify files, implement the design, or launch another workflow before that confirmation.
